import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@/components/queue/dashboard";
import { NotMember } from "@/components/queue/not-member";
import { TAB_COOKIE, TABS, type Tab } from "@/components/queue/tabs";
import { auth } from "@/lib/auth";
import { findKickUser, lookupRank, reconnect } from "@/lib/server/dashboard";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions } from "@/lib/server/kick";
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";
import type { Channel, QueueState } from "@/types/queue";

// The connection pill's stale limit: three missed 10-minute health checks.
const STALE_MS = 30 * 60_000;

// Chat must not wait for Reconnect: the 10-minute check calls one fixed URL (a preview never
// gets it), so a member opening the dashboard repairs missing, failing or stale subscriptions
// before the first paint. Healthy channels skip it.
async function repairSubscriptions(c: Channel) {
  if (c.subscriptions_ok_at && !c.subscription_error && Date.now() - Date.parse(c.subscriptions_ok_at) < STALE_MS) return;
  c.subscription_error = await ensureSubscriptions(c.kick_channel_id);
  if (!c.subscription_error) c.subscriptions_ok_at = new Date().toISOString();
  await adminDb().rpc("set_subscription_state", { p_channel: c.id, p_error: c.subscription_error });
}

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> };

async function tabOf(searchParams: Props["searchParams"]): Promise<Tab> {
  const q = (await searchParams).tab ?? (await cookies()).get(TAB_COOKIE)?.value;
  return TABS.find((t) => t === q) ?? "queue";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  return { title: translate(lang, `tab.${await tabOf(searchParams)}`), robots: { index: false, follow: false } };
}

// Server-rendered first paint with its version (spec § Realtime → Client store), read as the
// signed-in user so RLS decides what exists.
export default async function ChannelPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9_-]{1,40}$/.test(slug)) notFound();
  const session = await auth();
  const user = kickUser(session);
  const profileId = user && (await ensureProfile(session));
  if (!user || !profileId) redirect(`/?callbackUrl=${encodeURIComponent(`/c/${slug}`)}`);

  const db = userDb(profileId);
  const { data: channel } = await db.from("channels").select("id").eq("slug", slug).maybeSingle();
  if (!channel) return <NotMember />;
  const { data, error } = await db.rpc("get_state", { p_channel: channel.id });
  if (error?.message === "auth.not_member") return <NotMember />;
  if (error || !data) throw new Error(`get_state ${error?.code ?? "empty"}`);

  const state = data as QueueState;
  await repairSubscriptions(state.channel);
  let tab = await tabOf(searchParams);
  if (tab === "settings" && state.role !== "owner") tab = "queue";
  return (
    <Dashboard
      initial={state}
      me={user.kickUserId}
      account={{ name: user.username, image: user.image ?? null }}
      tab={tab}
      actions={{ lookupRank, findKickUser, reconnect }}
    />
  );
}
