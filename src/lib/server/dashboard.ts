"use server";
import "server-only";
import { auth } from "@/lib/auth";
import { fetchRank } from "@/lib/riot/client";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions, kickUserBySlug } from "@/lib/server/kick";
import { kickUser } from "@/lib/server/profile";

// Server actions the dashboard calls for what the browser cannot do itself (Riot, Kick). Each
// one re-checks the session and the caller's membership with the secret key: a server action
// is a public endpoint.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RIOT_ID = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/u;

async function membership(channelId: string, ownerOnly = false): Promise<{ broadcaster: number } | null> {
  if (typeof channelId !== "string" || !UUID.test(channelId)) return null;
  const user = kickUser(await auth());
  if (!user) return null;
  const { data } = await adminDb()
    .from("channel_members")
    .select("role, channels(kick_channel_id)")
    .eq("channel_id", channelId)
    .eq("kick_user_id", user.kickUserId)
    .eq("blocked", false)
    .maybeSingle();
  if (!data || (ownerOnly && data.role !== "owner")) return null;
  return { broadcaster: (data.channels as unknown as { kick_channel_id: number }).kick_channel_id };
}

// Manual add / edit: the rank lands as its own event, like a chat join's (spec § Security → Riot).
export async function lookupRank(channelId: string, riotId: string): Promise<boolean> {
  if (typeof riotId !== "string" || !RIOT_ID.test(riotId) || !(await membership(channelId))) return false;
  const db = adminDb();
  const { data: s } = await db.from("settings").select("riot_enabled, riot_region").eq("channel_id", channelId).single();
  if (!s?.riot_enabled) return false;
  const rank = await fetchRank(riotId, s.riot_region);
  if (!rank) return false;
  const { error } = await db.rpc("set_riot_rank", {
    p_channel: channelId, p_riot_id: riotId, p_puuid: rank.puuid, p_game_name: rank.gameName, p_tag_line: rank.tagLine,
    p_tier: rank.tier, p_division: rank.division, p_lp: rank.lp, p_icon: rank.icon,
  });
  if (error) console.error(JSON.stringify({ route: "action/lookupRank", error: error.message }));
  return !error;
}

export type FoundKickUser = { ok: true; id: number; username: string } | { ok: false; error: "auth" | "not_found" | "kick" };

// Settings → Moderators: the owner adds a moderator by Kick username before they chat.
export async function findKickUser(channelId: string, username: string): Promise<FoundKickUser> {
  if (!(await membership(channelId, true))) return { ok: false, error: "auth" };
  const name = typeof username === "string" ? username.trim().replace(/^@/, "") : "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) return { ok: false, error: "not_found" };
  try {
    const found = await kickUserBySlug(name.toLowerCase());
    if (!found) return { ok: false, error: "not_found" };
    return { ok: true, id: found.id, username: name.toLowerCase() === found.slug ? name : found.slug };
  } catch {
    return { ok: false, error: "kick" };
  }
}

// The connection pill's Reconnect: re-creates missing Kick subscriptions now instead of at the
// next 10-minute health check. Returns the error, or null when both subscriptions exist.
export async function reconnect(channelId: string): Promise<string | null> {
  const m = await membership(channelId);
  if (!m) return "auth";
  const error = await ensureSubscriptions(m.broadcaster);
  await adminDb().rpc("set_subscription_state", { p_channel: channelId, p_error: error });
  return error;
}
