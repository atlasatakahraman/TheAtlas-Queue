import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@/components/queue/dashboard";
import { NotMember } from "@/components/queue/not-member";
import { TAB_COOKIE, TABS, type Tab } from "@/components/queue/tabs";
import { auth } from "@/lib/auth";
import { findKickUser, lookupRank, reconnect, refreshRank } from "@/lib/server/dashboard";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";
import { adminDb } from "@/lib/server/admin-db";
import { ensureSubscriptions } from "@/lib/server/kick";
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";
import type { Channel, Game, GameView, PlayerRecord, QueueState } from "@/types/queue";

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

// games/[n]/page.tsx re-exports this page: n set is a game's page (Stage 10, DESIGN.md § A game's page).
type Props = { params: Promise<{ slug: string; n?: string }>; searchParams: Promise<{ tab?: string }> };

async function tabOf(searchParams: Props["searchParams"]): Promise<Tab> {
  const q = (await searchParams).tab ?? (await cookies()).get(TAB_COOKIE)?.value;
  return TABS.find((t) => t === q) ?? "queue";
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const { n } = await params;
  const title = n ? translate(lang, "game.tab_title", undefined, { n }) : translate(lang, `tab.${await tabOf(searchParams)}`);
  return { title, robots: { index: false, follow: false } };
}

// The game, the numbers either side of it and the records of the names in it, as the member.
async function gameView(db: ReturnType<typeof userDb>, channel: string, n: number): Promise<GameView> {
  const games = () => db.from("games").select("*").eq("channel_id", channel).is("removed_at", null);
  const [{ data: game }, { data: prev }, { data: next }] = await Promise.all([
    games().eq("n", n).maybeSingle(),
    games().lt("n", n).order("n", { ascending: false }).limit(1).maybeSingle(),
    games().gt("n", n).order("n", { ascending: true }).limit(1).maybeSingle(),
  ]);
  const names = ((game as Game | null)?.teams ?? []).flat().flatMap((e) => (e.removed ? [] : [e.kick_username.toLowerCase()]));
  const { data: records } = names.length
    ? await db.from("player_records").select("*").eq("channel_id", channel).in("name", names)
    : { data: [] };
  return { n, game: game as Game | null, prev: (prev as Game | null)?.n ?? null, next: (next as Game | null)?.n ?? null, records: (records ?? []) as PlayerRecord[] };
}

// Server-rendered first paint with its version (spec § Realtime → Client store), read as the
// signed-in user so RLS decides what exists.
export default async function ChannelPage({ params, searchParams }: Props) {
  const { slug, n } = await params;
  if (!/^[a-z0-9_-]{1,40}$/.test(slug) || (n !== undefined && !/^[1-9][0-9]{0,8}$/.test(n))) notFound();
  const session = await auth();
  const user = kickUser(session);
  const profileId = user && (await ensureProfile(session));
  if (!user || !profileId) redirect(`/?callbackUrl=${encodeURIComponent(`/c/${slug}${n ? `/games/${n}` : ""}`)}`);

  const db = userDb(profileId);
  const { data: channel } = await db.from("channels").select("id").eq("slug", slug).maybeSingle();
  if (!channel) return <NotMember />;
  const { data, error } = await db.rpc("get_state", { p_channel: channel.id });
  if (error?.message === "auth.not_member") return <NotMember />;
  if (error || !data) throw new Error(`get_state ${error?.code ?? "empty"}`);

  const state = data as QueueState;
  await repairSubscriptions(state.channel);
  let tab: Tab = n ? "games" : await tabOf(searchParams);
  if (tab === "settings" && state.role !== "owner") tab = "queue";
  return (
    <Dashboard
      initial={state}
      me={user.kickUserId}
      account={{ name: user.username, image: user.image ?? null }}
      tab={tab}
      game={n ? await gameView(db, channel.id, Number(n)) : undefined}
      actions={{ lookupRank, refreshRank, findKickUser, reconnect }}
    />
  );
}
