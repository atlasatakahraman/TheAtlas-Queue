import { after, NextResponse, type NextRequest } from "next/server";
import { parseCommand, type Commands } from "@/lib/kick-command";
import { fetchRank } from "@/lib/riot/client";
import { adminDb } from "@/lib/server/admin-db";
import { answer, isCommandsAsk, listCommands, sendRules, sendWatchLink } from "@/lib/server/chat-replies";
import { kickLive, verifyWebhook } from "@/lib/server/kick";

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

// ponytail: per-instance 60 s cache, so plain chat reaches Postgres only for a sender's badge
// change (P10); a command or member change reaches chat within a minute. Invalidate across
// instances if that ever matters.
const contexts = new Map<number, { at: number; ctx: Context | null }>();

// The badges each sender last showed this instance (P10): a queued viewer's badges follow their
// chat, but only a change reaches Postgres. ponytail: per-instance and bounded; another instance
// sends its own first sighting, which writes nothing if unchanged.
const seenBadges = new Map<string, { at: number; key: string }>();
const BADGES_TTL = 10 * 60_000;
function badgesChanged(broadcaster: number, sender: number, badges: string[]): boolean {
  const id = `${broadcaster}:${sender}`;
  const key = [...badges].sort().join(",");
  const hit = seenBadges.get(id);
  if (hit && hit.key === key && Date.now() - hit.at < BADGES_TTL) return false;
  if (seenBadges.size > 5000) seenBadges.clear();
  seenBadges.set(id, { at: Date.now(), key });
  return true;
}

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
  if (badgesChanged(broadcaster!, s.user_id!, badges))
    after(async () => {
      const { error } = await adminDb().rpc("refresh_badges", { p_broadcaster: broadcaster, p_sender_id: s.user_id, p_badges: badges });
      if (error) console.error(JSON.stringify({ route: "kick/webhook", step: "refresh_badges", error: error.code }));
    });
  if (s.user_id !== broadcaster && needsBadgeSync(ctx.members[String(s.user_id)], badges.includes("moderator"))) {
    const { error } = await adminDb().rpc("sync_member_badge", {
      p_broadcaster: broadcaster, p_user_id: s.user_id, p_username: s.username, p_is_mod: badges.includes("moderator"),
    });
    if (error) throw new Error(`sync_member_badge ${error.code}`);
    contexts.delete(broadcaster!);
  }

  const cmd = parseCommand(String(p.content ?? ""), ctx.commands);
  if (!cmd) {
    if (!isCommandsAsk(String(p.content ?? ""))) return "chat";
    after(() => listCommands(ctx.channel_id, ctx.commands));
    return "commands";
  }
  // The watch command is answered here, never by ingest_chat: it changes nothing in the queue.
  if (cmd.command === "watch") {
    after(() => sendWatchLink(ctx.channel_id));
    return "watch";
  }
  if (cmd.command === "rules") {
    after(() => sendRules(ctx.channel_id));
    return "rules";
  }
  const ingest = (gate: "check" | "confirmed") =>
    adminDb().rpc("ingest_chat", {
      p_broadcaster: broadcaster, p_message_id: messageId, p_command: cmd.command, p_riot_id: cmd.riotId,
      p_sender_id: s.user_id, p_sender_name: s.username, p_badges: badges, p_live_gate: gate,
    });
  let { data, error } = await ingest("check");
  // Only while live (DESIGN.md § Settings → Joining): the database said offline without writing.
  // Kick decides: live means a missed start, recorded before the join goes through once; offline,
  // silence or an error records the refusal, re-checked under the channel lock.
  if (!error && (data as { result?: string } | null)?.result === "offline") {
    const live = await kickLive(broadcaster!);
    if (live) {
      const { error: e } = await adminDb().rpc("set_live", {
        p_broadcaster: broadcaster, p_live: true, p_started_at: live.startedAt, p_title: live.title,
      });
      if (e) console.error(JSON.stringify({ route: "kick/webhook", step: "heal_live", error: e.code }));
    }
    ({ data, error } = await ingest(live ? "check" : "confirmed"));
    if (!error && (data as { result?: string } | null)?.result === "offline") ({ data, error } = await ingest("confirmed"));
  }
  if (error) throw new Error(`ingest_chat ${error.message}`);
  const result = data as { result: string; reason?: string; rank_needed?: boolean } | null;
  // The chat reply, when replies are on, after Kick has its 200.
  if (result) after(() => answer(ctx.channel_id, cmd.command, result, s.username!));

  // Riot never blocks a join: the rank lands as a second event after the response is sent.
  if (result?.rank_needed && cmd.riotId && ctx.riot) {
    const [riotId, region, channel] = [cmd.riotId, ctx.riot, ctx.channel_id];
    after(async () => {
      const rank = await fetchRank(riotId, region);
      if (!rank) return;
      const { error: e } = await adminDb().rpc("set_riot_rank", {
        p_channel: channel, p_riot_id: riotId, p_puuid: rank.puuid, p_game_name: rank.gameName, p_tag_line: rank.tagLine,
        p_tier: rank.tier, p_division: rank.division, p_lp: rank.lp, p_icon: rank.icon,
        p_wins: rank.wins, p_losses: rank.losses, p_level: rank.level,
      });
      if (e) console.error(JSON.stringify({ route: "kick/webhook", step: "rank", error: e.code }));
    });
  }
  return result ? (result.reason ?? result.result) : "unknown_channel";
}

async function onLive(p: { broadcaster?: { user_id?: number }; is_live?: boolean; started_at?: string | null; title?: unknown }) {
  if (!Number.isSafeInteger(p.broadcaster?.user_id)) return "ignored";
  const { data, error } = await adminDb().rpc("set_live", {
    p_broadcaster: p.broadcaster!.user_id, p_live: p.is_live === true, p_started_at: p.started_at ?? null,
    // The top bar's Live tooltip (D25); the database trims it to 200 characters.
    p_title: typeof p.title === "string" ? p.title : null,
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
