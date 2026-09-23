"use server";
import "server-only";
import { auth } from "@/lib/auth";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions, kickChannel } from "@/lib/server/kick";
import type { Onboarded, OnboardSettings } from "@/types";

// /welcome step 1 (spec § Flows → Onboarding). The channel is keyed by the signed-in user's own
// Kick id, so only the Kick user who owns a channel can create it. Safe to call again: Retry
// re-runs it, and it re-creates any missing subscription.
export async function setupChannel(): Promise<Onboarded> {
  const session = await auth();
  const kickUserId = Number((session as { kickUserId?: string } | null)?.kickUserId ?? session?.user?.id);
  const username = session?.user?.name;
  if (!Number.isSafeInteger(kickUserId) || kickUserId <= 0 || !username) return { ok: false, error: "auth" };

  const channel = await kickChannel(kickUserId).catch(() => null);
  if (!channel) return { ok: false, error: "kick" };

  const db = adminDb();
  const { data, error } = await db.rpc("onboard_channel", { p_kick_user_id: kickUserId, p_username: username, p_slug: channel.slug });
  if (error) return { ok: false, error: error.message === "request.invalid" ? "slug" : "db" };
  const channelId = (data as { channel_id: string }).channel_id;

  const subscriptionError = await ensureSubscriptions(kickUserId);
  await db.rpc("set_subscription_state", { p_channel: channelId, p_error: subscriptionError });
  const { data: settings } = await db
    .from("settings")
    .select("join_command, require_riot_id, riot_region, stream_locale")
    .eq("channel_id", channelId)
    .single();
  if (!settings) return { ok: false, error: "db" };
  return { ok: true, channelId, slug: channel.slug, subscriptionError, settings: settings as OnboardSettings };
}
