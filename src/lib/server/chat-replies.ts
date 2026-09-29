import "server-only";
import { type LabelKey, type Labels, type Lang, translate } from "@/lib/i18n";
import type { Commands } from "@/lib/kick-command";
import { adminDb } from "@/lib/server/admin-db";
import { sendChat } from "@/lib/server/kick-tokens";
import { SITE } from "@/lib/server/site";

// Chat replies (DESIGN.md § Settings → Chat replies): run after the webhook has answered Kick, in
// the stream language with the streamer's own labels, only while replies are on.

type Result = { result: string; reason?: string; left?: number; enabled?: boolean; position?: number | null };
type Settings = { chat_replies: boolean; stream_locale: Lang; labels: Labels | null };

async function say(channelId: string, key: LabelKey, vars: Record<string, string | number>, s?: Settings) {
  s ??= (await adminDb().from("settings").select("chat_replies, stream_locale, labels").eq("channel_id", channelId).single()).data as Settings;
  if (!s?.chat_replies) return;
  try {
    const res = await sendChat(channelId, translate(s.stream_locale, key, s.labels ?? undefined, vars));
    if (res.status >= 300) console.error(JSON.stringify({ route: "chat/reply", status: res.status, body: res.body.slice(0, 120) }));
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e);
    if (error !== "no kick token") console.error(JSON.stringify({ route: "chat/reply", error: error.slice(0, 120) }));
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
  if (command === "position" && r.position) return say(channelId, "chat.position", { name, position: r.position });
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
  const { data } = await adminDb().from("settings").select("chat_replies, stream_locale, labels, perk_enabled, watch_enabled").eq("channel_id", channelId).single();
  const s = data as (Settings & { perk_enabled: boolean; watch_enabled: boolean }) | null;
  if (!s?.chat_replies) return;
  const keys = ["join", "leave", "position", "away", ...(s.perk_enabled ? ["perk" as const] : []), ...(s.watch_enabled ? ["watch" as const] : [])] as const;
  const list = keys.map((k) => `${translate(s.stream_locale, `settings.${k}_command`)} ${commands[k]}`).join(", ");
  await say(channelId, "chat.commands", { list, url: `${SITE}/wiki/chat-commands?lang=${s.stream_locale}` }, s);
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
  await say(channelId, "chat.watch", { url: `${SITE}/watch/${s.channels.slug}?lang=${s.stream_locale}` }, s);
}
