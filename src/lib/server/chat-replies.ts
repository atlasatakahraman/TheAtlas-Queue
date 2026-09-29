import "server-only";
import { type LabelKey, type Labels, type Lang, translate } from "@/lib/i18n";
import type { Commands } from "@/lib/kick-command";
import { adminDb } from "@/lib/server/admin-db";
import { sendChat } from "@/lib/server/kick-tokens";
import { HERE } from "@/lib/server/site";

// Chat replies (DESIGN.md § Settings → Chat replies): run after the webhook has answered Kick, in
// the stream language with the streamer's own labels, only while replies are on.

type Result = { result: string; reason?: string; left?: number; enabled?: boolean; eligible?: boolean; position?: number | null };
type Settings = { chat_replies: boolean; stream_locale: Lang; labels: Labels | null };

// Batched (owner, 2026-09-29): a channel's answers wait up to 5 s and go out together, so a join
// rush is a few messages, not one per viewer. The first answer's after() carries the send; the
// rest wait on it.
// ponytail: per-instance batch; answers landing on another instance make their own message.
const WAIT = 5_000;
const MAX = 500; // Kick's chat message limit
type Line = { key: LabelKey; vars: Record<string, string | number> };
type Batch = { s: Settings; lines: Line[]; sent?: Promise<void> };
const batches = new Map<string, Batch>();

async function say(channelId: string, key: LabelKey, vars: Record<string, string | number>, s?: Settings) {
  s ??= (await adminDb().from("settings").select("chat_replies, stream_locale, labels").eq("channel_id", channelId).single()).data as Settings;
  if (!s?.chat_replies) return;
  let b = batches.get(channelId);
  if (!b) {
    const batch: Batch = { s, lines: [] };
    batch.sent = new Promise<void>((r) => setTimeout(r, WAIT)).then(() => flush(channelId, batch));
    batches.set(channelId, (b = batch));
  }
  b.lines.push({ key, vars });
  return b.sent;
}

// The batch as messages: several joins become one "Joined the queue: @a #3, @b #4" line, the
// rest stay their own sentences, packed up to Kick's limit.
async function flush(channelId: string, b: Batch) {
  batches.delete(channelId);
  const t = (key: LabelKey, vars: Line["vars"]) => translate(b.s.stream_locale, key, b.s.labels ?? undefined, vars);
  const joins = b.lines.filter((l) => l.key === "chat.joined");
  const pieces: string[] = [];
  if (joins.length === 1) pieces.push(t("chat.joined", joins[0].vars));
  let list: string[] = [];
  for (const j of joins.length > 1 ? joins : []) {
    const item = `@${j.vars.name} #${j.vars.position}`;
    if (list.length && t("chat.joined.many", { list: [...list, item].join(", ") }).length > MAX) {
      pieces.push(t("chat.joined.many", { list: list.join(", ") }));
      list = [];
    }
    list.push(item);
  }
  if (list.length) pieces.push(t("chat.joined.many", { list: list.join(", ") }));
  for (const l of b.lines) if (l.key !== "chat.joined") pieces.push(t(l.key, l.vars));
  const messages: string[] = [];
  for (const p of pieces.flatMap(split)) {
    const last = messages.length - 1;
    if (last >= 0 && messages[last].length + 1 + p.length <= MAX) messages[last] += ` ${p}`;
    else messages.push(p);
  }
  for (const m of messages) {
    try {
      const res = await sendChat(channelId, m);
      if (res.status >= 300) console.error(JSON.stringify({ route: "chat/reply", status: res.status, body: res.body.slice(0, 120) }));
    } catch (e) {
      const error = String(e instanceof Error ? e.message : e);
      if (error !== "no kick token") console.error(JSON.stringify({ route: "chat/reply", error: error.slice(0, 120) }));
      return;
    }
  }
}

// The answer to one command's ingest_chat result; nothing for results chat need not hear.
export async function answer(channelId: string, command: keyof Commands, r: Result, name: string) {
  if (command === "join" && r.result === "joined") {
    const { count } = await adminDb()
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .eq("status", "waiting")
      .is("deleted_at", null);
    return say(channelId, "chat.joined", { name, position: count ?? 1 });
  }
  if (command === "join" && r.result === "rejected" && (r.reason === "queue.banned" || r.reason === "queue.duplicate"))
    return say(channelId, r.reason === "queue.banned" ? "chat.rejected.banned" : "chat.rejected.duplicate", { name });
  // Offline (only while live) and closed refusals: one line for the whole chat, not one per viewer.
  if (command === "join" && r.result === "rejected" && r.reason === "queue.offline")
    return throttled(`${channelId}:offline`) ? undefined : say(channelId, "chat.rejected.offline", {});
  if (command === "join" && r.result === "rejected" && r.reason === "queue.closed")
    return throttled(`${channelId}:closed`) ? undefined : say(channelId, "chat.rejected.closed", {});
  if (command === "position" && r.position) return say(channelId, "chat.position", { name, position: r.position });
  // Without a perk badge (0039): who the perk is for, once per viewer per 30 s.
  if (command === "perk" && r.result === "perk" && r.enabled && r.eligible === false)
    return throttled(`${channelId}:perk-none:${name.toLowerCase()}`) ? undefined : perkNone(channelId, name);
  if (command === "perk" && r.result === "perk" && r.enabled) return say(channelId, "chat.perk", { name, uses: r.left ?? 0 });
}

// !komutlar / !commands (fixed in both languages) and the watch command: each at most once per
// 30 s per channel.
// ponytail: per-instance throttle; a second instance may answer once more inside the 30 s.
const answered = new Map<string, number>();
function throttled(key: string) {
  if (Date.now() - (answered.get(key) ?? 0) < 30_000) return true;
  answered.set(key, Date.now());
  return false;
}
export const isCommandsAsk = (content: string) => /^!(komutlar|commands)$/iu.test(content.trim().split(/\s/u)[0] ?? "");

export async function listCommands(channelId: string, commands: Commands) {
  if (throttled(`${channelId}:commands`)) return;
  const { data } = await adminDb().from("settings").select("chat_replies, stream_locale, labels, perk_enabled, watch_enabled, commands_list, rules").eq("channel_id", channelId).single();
  const s = data as (Settings & { perk_enabled: boolean; watch_enabled: boolean; commands_list: boolean; rules: string }) | null;
  if (!s?.chat_replies || !s.commands_list) return;
  const keys = ["join", "leave", "position", "away", ...(s.perk_enabled ? ["perk" as const] : []), ...(s.watch_enabled ? ["watch" as const] : []), ...(s.rules.trim() ? ["rules" as const] : [])] as const;
  const list = keys.map((k) => `${translate(s.stream_locale, `settings.${k}_command`)} ${commands[k]}`).join(", ");
  await say(channelId, "chat.commands", { list, url: `${HERE}/wiki/chat-commands?lang=${s.stream_locale}` }, s);
}

// The watch command: the channel's /watch link, only while the watch page is on.
export async function sendWatchLink(channelId: string) {
  if (throttled(`${channelId}:watch`)) return;
  const { data } = await adminDb()
    .from("settings")
    .select("chat_replies, stream_locale, labels, watch_enabled, channels(slug)")
    .eq("channel_id", channelId)
    .single();
  const s = data as (Settings & { watch_enabled: boolean; channels: { slug: string } | null }) | null;
  if (!s?.watch_enabled || !s.channels) return;
  await say(channelId, "chat.watch", { url: `${HERE}/watch/${s.channels.slug}?lang=${s.stream_locale}` }, s);
}

// The rules command (0036): the streamer's own text on one line, silent while it is empty.
export async function sendRules(channelId: string) {
  if (throttled(`${channelId}:rules`)) return;
  const { data } = await adminDb().from("settings").select("chat_replies, stream_locale, labels, rules").eq("channel_id", channelId).single();
  const s = data as (Settings & { rules: string }) | null;
  const text = s?.rules.replace(/\s+/gu, " ").trim();
  if (!s || !text) return;
  await say(channelId, "chat.rules", { text }, s);
}

// The perk's badges joined like the badge picker's sentence, in the stream language.
async function perkNone(channelId: string, name: string) {
  const { data } = await adminDb().from("settings").select("chat_replies, stream_locale, labels, perk_badges").eq("channel_id", channelId).single();
  const s = data as (Settings & { perk_badges: string[] }) | null;
  if (!s) return;
  const badges = new Intl.ListFormat(s.stream_locale, { type: "conjunction" }).format(
    s.perk_badges.map((b) => translate(s.stream_locale, `badge.${b}.plural` as LabelKey)),
  );
  await say(channelId, "chat.perk.none", { name, badges }, s);
}

// A piece over Kick's limit (a long rules text) goes out in parts, cut at a space.
function split(p: string): string[] {
  const out: string[] = [];
  while (p.length > MAX) {
    const cut = p.lastIndexOf(" ", MAX);
    const at = cut > 0 ? cut : MAX;
    out.push(p.slice(0, at));
    p = p.slice(at).trimStart();
  }
  return [...out, p];
}
