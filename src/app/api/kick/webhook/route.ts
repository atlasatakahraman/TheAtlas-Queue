import { after, NextResponse, type NextRequest } from "next/server";
import { parseCommand, type Commands } from "@/lib/kick-command";
import { fetchRank } from "@/lib/riot/client";
import { adminDb } from "@/lib/server/admin-db";
import { verifyWebhook } from "@/lib/server/kick";

// Kick → Postgres (spec § Security → Webhook). 401 bad signature or stale timestamp; 200 for
// anything ignored, including an unknown channel; 500 on a database error, so Kick redelivers
// (ingest_chat dedupes by message id).
const MAX_BODY = 64 * 1024;
const MAX_AGE_MS = 5 * 60_000;

type Member = { source: "owner" | "badge" | "manual"; blocked: boolean; seen: string | null };
type Context = { channel_id: string; commands: Commands; riot: string | null; members: Record<string, Member> };
type Sender = {
  user_id?: number;
  username?: string;
  identity?: { badges?: { type?: string }[] } | null;
};

// ponytail: per-instance 60 s cache, so plain chat never reaches Postgres; a command or member
// change reaches chat within a minute. Invalidate across instances if that ever matters.
const contexts = new Map<number, { at: number; ctx: Context | null }>();

async function context(broadcaster: number): Promise<Context | null> {
  const hit = contexts.get(broadcaster);
  if (hit && Date.now() - hit.at < 60_000) return hit.ctx;
  const { data, error } = await adminDb().rpc("webhook_context", { p_broadcaster: broadcaster });
  if (error) throw new Error(`webhook_context ${error.code}`);
  contexts.set(broadcaster, { at: Date.now(), ctx: data as Context | null });
  return data as Context | null;
}

const DAY = 24 * 60 * 60_000;

// A moderator badge on a non-member, a badge member unseen for a day (refresh), or a badge
// member who lost it. Blocks and manual members are left to the owner.
function needsBadgeSync(m: Member | undefined, isMod: boolean): boolean {
  if (isMod) return !m || (m.source === "badge" && (!m.seen || Date.now() - Date.parse(m.seen) > DAY));
  return m?.source === "badge" && !m.blocked;
}

async function onChat(messageId: string, p: { broadcaster?: { user_id?: number }; sender?: Sender; content?: string }) {
  const broadcaster = p.broadcaster?.user_id;
  const s = p.sender;
  if (!Number.isSafeInteger(broadcaster) || !Number.isSafeInteger(s?.user_id) || !s?.username) return "ignored";
  const ctx = await context(broadcaster!);
  if (!ctx) return "unknown_channel";

  const badges = (s.identity?.badges ?? [])
    .map((b) => b.type)
    .filter((t): t is string => typeof t === "string" && /^[a-z_]{1,32}$/.test(t))
    .slice(0, 16);
  if (s.user_id !== broadcaster && needsBadgeSync(ctx.members[String(s.user_id)], badges.includes("moderator"))) {
    const { error } = await adminDb().rpc("sync_member_badge", {
      p_broadcaster: broadcaster, p_user_id: s.user_id, p_username: s.username, p_is_mod: badges.includes("moderator"),
    });
    if (error) throw new Error(`sync_member_badge ${error.code}`);
    contexts.delete(broadcaster!);
  }

  const cmd = parseCommand(String(p.content ?? ""), ctx.commands);
  if (!cmd) return "chat";
  const { data, error } = await adminDb().rpc("ingest_chat", {
    p_broadcaster: broadcaster, p_message_id: messageId, p_command: cmd.command, p_riot_id: cmd.riotId,
    p_sender_id: s.user_id, p_sender_name: s.username, p_badges: badges,
  });
  if (error) throw new Error(`ingest_chat ${error.message}`);
  const result = data as { result: string; reason?: string; rank_needed?: boolean } | null;

  // Riot never blocks a join: the rank lands as a second event after the response is sent.
  if (result?.rank_needed && cmd.riotId && ctx.riot) {
    const [riotId, region, channel] = [cmd.riotId, ctx.riot, ctx.channel_id];
    after(async () => {
      const rank = await fetchRank(riotId, region);
      if (!rank) return;
      const { error: e } = await adminDb().rpc("set_riot_rank", {
        p_channel: channel, p_riot_id: riotId, p_puuid: rank.puuid, p_game_name: rank.gameName, p_tag_line: rank.tagLine,
        p_tier: rank.tier, p_division: rank.division, p_lp: rank.lp, p_icon: rank.icon,
      });
      if (e) console.error(JSON.stringify({ route: "kick/webhook", step: "rank", error: e.code }));
    });
  }
  return result ? (result.reason ?? result.result) : "unknown_channel";
}

async function onLive(p: { broadcaster?: { user_id?: number }; is_live?: boolean; started_at?: string | null }) {
  if (!Number.isSafeInteger(p.broadcaster?.user_id)) return "ignored";
  const { data, error } = await adminDb().rpc("set_live", {
    p_broadcaster: p.broadcaster!.user_id, p_live: p.is_live === true, p_started_at: p.started_at ?? null,
  });
  if (error) throw new Error(`set_live ${error.code}`);
  return data ? (p.is_live ? "live" : "offline") : "unknown_channel";
}

const reply = (status: number) => new NextResponse(null, { status });

export async function POST(request: NextRequest) {
  const started = Date.now();
  const h = request.headers;
  const id = h.get("kick-event-message-id");
  const timestamp = h.get("kick-event-message-timestamp");
  const signature = h.get("kick-event-signature");
  const type = h.get("kick-event-type");

  if (Number(h.get("content-length") ?? 0) > MAX_BODY) return reply(413);
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_BODY) return reply(413);
  if (!id || !timestamp || !signature || !type || id.length > 128) return reply(401);
  // RFC 3339 may carry nanoseconds; Date.parse wants at most milliseconds.
  const sent = Date.parse(timestamp.replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > MAX_AGE_MS) return reply(401);
  if (!(await verifyWebhook(id, timestamp, body, signature))) return reply(401);

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return reply(400);
  }

  let result = "ignored";
  try {
    if (type === "chat.message.sent") result = await onChat(id, payload as Parameters<typeof onChat>[1]);
    else if (type === "livestream.status.updated") result = await onLive(payload as Parameters<typeof onLive>[0]);
  } catch (e) {
    console.error(JSON.stringify({ route: "kick/webhook", type, error: String(e instanceof Error ? e.message : e).slice(0, 120), ms: Date.now() - started }));
    return reply(500);
  }
  if (result !== "chat") console.log(JSON.stringify({ route: "kick/webhook", type, result, ms: Date.now() - started }));
  return reply(200);
}
