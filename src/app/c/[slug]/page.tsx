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
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";
import type { QueueState } from "@/types/queue";

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
  let tab = await tabOf(searchParams);
  if (tab === "settings" && state.role !== "owner") tab = "queue";
  return <Dashboard initial={state} me={user.kickUserId} tab={tab} actions={{ lookupRank, findKickUser, reconnect }} />;
}
