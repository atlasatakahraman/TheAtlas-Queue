"use client";
import { Heart, HistoryIcon, ListOrdered, Settings2, ShieldAlert, Swords, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { I18nProvider, useT } from "@/components/i18n";
import { TopBar } from "@/components/queue/header";
import { ConfirmHost } from "@/components/queue/confirm";
import { Masthead } from "@/components/queue/masthead";
import { ModerationTab } from "@/components/queue/moderation-tab";
import { NotMember } from "@/components/queue/not-member";
import { PageMenu } from "@/components/queue/page-menu";
import { Tag } from "@/components/queue/player-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Hotkeys, Palette } from "@/components/queue/palette";
import { AddPlayerDialog, EditPlayerDialog } from "@/components/queue/player-dialogs";
import { QueueTab } from "@/components/queue/queue-tab";
import { RevealDriver } from "@/components/queue/reveal";
import { SanctionDialog } from "@/components/queue/sanction-dialog";
import { SettingsPage } from "@/components/queue/settings-page";
import { QueueProvider, useAct, useQueue, useStore } from "@/components/queue/store";
import { TeamsTab } from "@/components/queue/teams-tab";
import { rememberPlace, TAB_COOKIE, type Tab } from "@/components/queue/tabs";
import { GamePage } from "@/components/queue/game-page";
import { GamesTab } from "@/components/queue/games-tab";
import { HistoryTab } from "@/components/queue/history-tab";
import { enter, type SanctionDraft, SearchRefContext, UiContext } from "@/components/queue/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Labels } from "@/lib/i18n";
import { useNow } from "@/components/use-now";
import { SLIDE, useSlide } from "@/components/use-slide";
import { cn } from "@/lib/utils";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import type { DashboardActions, GameView, Player, QueueState } from "@/types/queue";
import { BAR, BAR_IN, COLS_COOKIE, MAIN, TAB, TAB_TRACK } from "@/components/queue/geometry";

type Account = { name: string; image: string | null };

// The credit August carried (owner, 2026-09-29; its hover easter egg stays removed, spec D14):
// the name and full respect in gold serif, a plain word between them in either language.
function Credit() {
  const { t } = useT();
  // The page keeps the scrollbar's room (scrollbar-gutter: stable). With no scrollbar in it the
  // room is empty, so the line moves right by half of it to sit on the window's centre.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const d = document.documentElement;
    const ro = new ResizeObserver(() => setShift(d.scrollHeight > d.clientHeight ? 0 : (innerWidth - d.getBoundingClientRect().width) / 2));
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return (
    <footer
      style={{ translate: `${shift}px` }}
      className="mt-auto flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-1 pt-6 text-center text-meta text-muted-foreground select-none"
    >
      {t("credit").split(/(\{name\}|\{respect\})/).map((part, i) =>
        part === "{name}" ? (
          <a
            key={i}
            href="https://github.com/atlasatakahraman"
            rel="noopener"
            className="rounded-sm font-serif text-body text-brand outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Atlas Ata KAHRAMAN
          </a>
        ) : part === "{respect}" ? (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              {/* The respect tag, score then heart as in a row, in gold serif. */}
              <span className="font-serif tabular-nums [&>span]:flex-row-reverse [&>span]:self-center [&>span]:text-body [&>span]:font-normal">
                <Tag tone="brand" icon={Heart}>100</Tag>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("mod.respect", { n: 100 })}</TooltipContent>
          </Tooltip>
        ) : (
          part.trim() && <span key={i}>{part.trim()}</span>
        ),
      )}
    </footer>
  );
}

export function Dashboard({ initial, me, account, tab, actions, game, settings = false, chatReconnect = false }: {
  initial: QueueState;
  me: number;
  account: Account;
  tab: Tab;
  actions: DashboardActions;
  // A game's page (/c/<channel>/games/<n>): the page in place of the tabs.
  game?: GameView;
  // The Settings page (/c/<channel>/settings/<section>): the page in place of the tabs.
  settings?: boolean;
  // Replies are on but Kick refused the stored token (DESIGN.md § Settings → Chat replies).
  chatReconnect?: boolean;
}) {
  return (
    <QueueProvider initial={initial} me={me} actions={actions}>
      <ChannelLabels>
        {chatReconnect && <ChatReconnect />}
        <Shell initialTab={tab} account={account} game={game} settings={settings} />
      </ChannelLabels>
    </QueueProvider>
  );
}

// Lasting until Reconnect: the same Kick consent the Settings switch asks for.
function ChatReconnect() {
  const { t } = useT();
  useEffect(() => {
    toast.warning(t("chat.reconnect"), {
      id: "chat-reconnect",
      duration: Infinity,
      action: { label: t("chat.reconnect.action"), onClick: () => void signIn("kick", { callbackUrl: window.location.href }, { scope: "user:read chat:write" }) },
    });
  }, [t]);
  return null;
}

// The streamer's label overrides apply live: a Settings save re-renders every label.
function ChannelLabels({ children }: { children: React.ReactNode }) {
  const labels = useQueue((v) => v.settings.labels) as Labels;
  return <I18nProvider labels={labels}>{children}</I18nProvider>;
}

const ICONS = { queue: ListOrdered, teams: Swords, moderation: ShieldAlert, history: HistoryIcon, games: Trophy, settings: Settings2 } as const;
const ORDER: Tab[] = ["queue", "teams", "moderation", "history", "games", "settings"];

function Shell({ initialTab, account, game, settings }: { initialTab: Tab; account: Account; game?: GameView; settings: boolean }) {
  const { t } = useT();
  const slug = useQueue((v) => v.channel.slug);
  const lost = useQueue((v) => v.lost);
  const count = useQueue((v) => v.players.length);
  const playing = useQueue((v) => v.players.filter((p) => p.status === "playing").length);
  const moderation = useQueue((v) => v.moderation);
  const now = useNow();
  const sanctions = now
    ? moderation.filter(
        (m) => !m.revoked_at && (!m.expires_at || Date.parse(m.expires_at) > now) && (m.games_left === null || m.games_left > 0),
      ).length
    : 0;
  const games = useQueue((v) => v.score.t1 + v.score.t2);
  const offline = useQueue((v) => !v.online || v.conn === "down");
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [palette, setPalette] = useState(false);
  const [adding, setAddingState] = useState(false);
  const [addTo, setAddTo] = useState<1 | 2 | null>(null);
  const [addAt, setAddAt] = useState<number | null>(null);
  // Closing Add player forgets its team and place, so the toolbar's Add adds to the end again.
  const setAdding = useCallback((open: boolean) => {
    setAddingState(open);
    if (!open) {
      setAddTo(null);
      setAddAt(null);
    }
  }, []);
  const [editing, setEditing] = useState<Player | null>(null);
  const [sanction, setSanction] = useState<SanctionDraft | null>(null);
  const [entering, setEntering] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  // The tab indicator slides to the active tab; a switched-to panel slides in from the side the
  // pointer travelled (dir), so the movement reads as one gesture.
  const { track, box } = useSlide(tab);
  const tabRef = useRef(initialTab);
  const [dir, setDir] = useState(0);
  const focusSearch = () => {
    setTab("queue");
    requestAnimationFrame(() => search.current?.focus());
  };

  useEffect(() => {
    const id = setTimeout(() => setEntering(false), 1500);
    rememberPlace(`/c/${slug}`);
    return () => clearTimeout(id);
  }, [slug]);

  // The table's columns, for the next load's skeleton (the server has no settings while loading).
  const cols = useQueue((v) => (v.settings.require_riot_id && v.settings.riot_enabled ? "ranks" : v.settings.require_riot_id ? "ids" : "plain"));
  useEffect(() => {
    document.cookie = `${COLS_COOKIE}=${cols}; path=/; max-age=31536000; samesite=lax`;
  }, [cols]);

  useEffect(() => {
    document.title = `${game ? t("game.tab_title", { n: game.n }) : t(settings ? "tab.settings" : `tab.${tab}`)} · TheAtlas Queue`;
  }, [tab, t, game, settings]);

  // ?tab= in the URL, and a cookie so the server renders the same tab next time.
  const router = useRouter();
  const setTab = useCallback((next: Tab) => {
    // Settings is its own page (D20); from a game's page or Settings a tab is the dashboard again.
    if (next === "settings") return router.push(`/c/${slug}/settings`);
    if (game || settings) {
      document.cookie = `${TAB_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      return router.push(`/c/${slug}?tab=${next}`);
    }
    setDir(Math.sign(ORDER.indexOf(next) - ORDER.indexOf(tabRef.current)));
    tabRef.current = next;
    setTabState(next);
    document.cookie = `${TAB_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }, [game, settings, router, slug]);

  if (lost) return <NotMember />;

  // Settings is not a tab (owner, 2026-09-23) but its own page (D20): the top bar's gear, the
  // account menu, the page menu and the palette open it.
  const tabs: Tab[] = ["queue", "teams", "moderation", "history", "games"];
  const counts: Record<Tab, number> = { queue: count, teams: playing, moderation: sanctions, history: 0, games, settings: 0 };
  const e2 = enter(entering, 2);
  // Only the arriving panel slides in. Given to the leaving one too, its animation kept Radix
  // from unmounting it, so it sat under the new panel for ~240ms (owner, 2026-09-27).
  const panel = (v: Tab) =>
    entering || dir === 0 || v !== tab ? {} : { className: "tab-in", style: { "--tab-from": `${dir * 16}px` } as React.CSSProperties };
  const active = tabs.indexOf(tab);

  return (
    <UiContext.Provider value={{ tab, setTab, palette, setPalette, adding, setAdding, addTo, setAddTo, addAt, setAddAt, editing, setEditing, sanction, setSanction, focusSearch, entering, account, game: game?.n ?? null, settings }}>
      <SearchRefContext.Provider value={search}>
      <PageMenu>
      {/* The top bar runs the full width on its own ground (August's header); its content keeps
          the page's width. It sticks while the page scrolls. */}
      <div className={cn("sticky top-0 z-40", BAR)}>
        <div className={BAR_IN}>
          <TopBar />
        </div>
      </div>
      <div className={MAIN}>
        {!game && !settings && <Masthead />}
        {offline && (
          <div role="status" className="rounded-lg border border-warning/45 px-4 py-2.5 text-meta text-foreground">
            {t("offline.banner")}
          </div>
        )}
        {game ? (
          <GamePage view={game} />
        ) : settings ? (
          <SettingsPage />
        ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-6">
          {/* Full width, equal tabs (August). A raised card slides under the active tab; each tab
              carries its icon (gold when active, tilting on hover like the buttons) and a live count
              (players, in teams, active sanctions) when there is one. Arrow keys move between tabs
              (Radix). */}
          <TabsList
            ref={track}
            variant="line"
            style={e2.style}
            className={cn(TAB_TRACK, e2.className)}
          >
            <span ref={box} aria-hidden className={cn(SLIDE, "inset-y-1.5 rounded-lg bg-card shadow-sm ring-1 ring-border dark:bg-accent")} />
            {tabs.map((k) => {
              const Icon = ICONS[k];
              return (
                <TabsTrigger
                  key={k}
                  value={k}
                  className={cn(TAB, "group/tab gap-2 px-5 text-body text-muted-foreground select-none after:hidden hover:text-foreground data-[state=active]:text-foreground")}
                >
                  {/* The gold line under the label (icon, name, count) grows from its centre when the
                      tab turns active; the stock full-width underline stays hidden (after:hidden). */}
                  <span className="relative inline-flex items-center gap-2.5 after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.16,1,0.3,1)] group-data-[state=active]/tab:after:scale-x-100 motion-reduce:after:transition-none">
                    <Icon
                      aria-hidden
                      className="size-4.5 transition-[rotate,scale,color] duration-200 ease-out group-hover/tab:-rotate-6 group-hover/tab:scale-115 group-data-[state=active]/tab:text-brand motion-reduce:transition-none"
                    />
                    {t(`tab.${k}`)}
                    {/* The count is a bare figure (owner, 2026-09-27: the capsule looked off), gold on
                        the active tab; keyed on the value, it ticks up into place when it changes. */}
                    {counts[k] > 0 && (
                      <span
                        key={counts[k]}
                        className="animate-count min-w-[2ch] text-left font-serif font-medium tabular-nums text-muted-foreground/80 transition-colors group-data-[state=active]/tab:text-brand"
                      >
                        {counts[k]}
                      </span>
                    )}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          <TabsContent value="queue" {...panel("queue")}>
            <QueueTab />
          </TabsContent>
          <TabsContent value="teams" {...panel("teams")}>
            <TeamsTab />
          </TabsContent>
          <TabsContent value="moderation" {...panel("moderation")}>
            <ModerationTab />
          </TabsContent>
          <TabsContent value="history" {...panel("history")}>
            <HistoryTab />
          </TabsContent>
          <TabsContent value="games" {...panel("games")}>
            <GamesTab />
          </TabsContent>
        </Tabs>
        )}
        <Credit />
      </div>
      </PageMenu>

      <AddPlayerDialog />
      <EditPlayerDialog />
      <SanctionDialog />
      <Palette />
      <ConfirmHost />
      <Hotkeys />
      <RevealDriver />
      <StreamEndNotice />

      {/* Mobile: the tabs move to a bottom bar (DESIGN.md § Mobile). */}
      <nav
        aria-label={t("tab.nav")}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {/* A pill slides behind the active icon (a fifth of the bar per tab); it fades on Settings. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 w-1/5 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${Math.max(active, 0) * 100}%)`, opacity: active < 0 ? 0 : 1 }}
        >
          <span className="mx-auto mt-1.5 block h-8 w-14 rounded-full bg-accent" />
        </span>
        {tabs.map((k) => {
          const Icon = ICONS[k];
          return (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? "page" : undefined}
              onClick={() => setTab(k)}
              className={cn(
                "relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-caption tracking-normal normal-case transition-colors select-none active:scale-95",
                tab === k ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon
                aria-hidden
                className={cn("size-5 transition-[translate,color] duration-200 ease-out motion-reduce:transition-none", tab === k && "-translate-y-px text-brand")}
              />
              {t(`tab.${k}`)}
            </button>
          );
        })}
      </nav>
      </SearchRefContext.Provider>
    </UiContext.Provider>
  );
}

// The stream ended and the server cleared the queue (0024): every open dashboard says so once,
// with the Undo the clear carries. Lines already in the feed when the page opened stay quiet.
function StreamEndNotice() {
  const { t } = useT();
  const store = useStore();
  const act = useAct();
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    const check = () => {
      const feed = store.get().activity;
      if (!seen.current) return void (seen.current = new Set(feed.map((a) => a.id)));
      for (const a of feed) {
        if (seen.current.has(a.id)) continue;
        seen.current.add(a.id);
        if (a.action !== "stream_offline" || !a.payload.count || a.undone_at) continue;
        toast(t("done.stream_offline", { n: String(a.payload.count) }), {
          duration: 15_000,
          action: { label: t("common.undo"), onClick: () => void act("undo", { p_activity: a.id }) },
        });
      }
    };
    check();
    return store.subscribe(check);
  }, [store, act, t]);
  return null;
}
