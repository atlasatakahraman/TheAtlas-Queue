"use server";
import "server-only";
import { auth } from "@/lib/auth";
import { fetchRank } from "@/lib/riot/client";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions, kickUserBySlug } from "@/lib/server/kick";
import { kickUser } from "@/lib/server/profile";
import type { FoundKickUser } from "@/types/queue";

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
  const { data: s } = await db.from("settings").select("riot_enabled, require_riot_id, riot_region").eq("channel_id", channelId).single();
  // Ranks need Riot IDs on too (0023).
  if (!s?.riot_enabled || !s.require_riot_id) return false;
  const rank = await fetchRank(riotId, s.riot_region);
  if (!rank) return false;
  const { error } = await db.rpc("set_riot_rank", {
    p_channel: channelId, p_riot_id: riotId, p_puuid: rank.puuid, p_game_name: rank.gameName, p_tag_line: rank.tagLine,
    p_tier: rank.tier, p_division: rank.division, p_lp: rank.lp, p_icon: rank.icon,
    p_wins: rank.wins, p_losses: rank.losses, p_level: rank.level,
  });
  if (error) console.error(JSON.stringify({ route: "action/lookupRank", error: error.message }));
  return !error;
}

// Refresh rank (D22, D31): a player's rank again, on demand. The Riot ID comes from the row,
// never the browser, and a player's rank is fetched at most once a minute (riot_cache.fetched_at).
export async function refreshRank(channelId: string, playerId: string): Promise<"ok" | "recent" | "failed"> {
  if (typeof playerId !== "string" || !UUID.test(playerId) || !(await membership(channelId))) return "failed";
  const db = adminDb();
  const { data: p } = await db
    .from("players")
    .select("riot_id, puuid")
    .eq("id", playerId)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!p?.riot_id) return "failed";
  if (p.puuid) {
    const { data: c } = await db.from("riot_cache").select("fetched_at").eq("puuid", p.puuid).maybeSingle();
    if (c && Date.now() - Date.parse(c.fetched_at) < 60_000) return "recent";
  }
  return (await lookupRank(channelId, p.riot_id)) ? "ok" : "failed";
}

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
