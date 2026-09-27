"use client";
import { HistoryIcon, ListOrdered, Settings2, ShieldAlert, Swords } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { I18nProvider, useT } from "@/components/i18n";
import { TopBar } from "@/components/queue/header";
import { ConfirmHost } from "@/components/queue/confirm";
import { Masthead } from "@/components/queue/masthead";
import { ModerationTab } from "@/components/queue/moderation-tab";
import { NotMember } from "@/components/queue/not-member";
import { PageMenu } from "@/components/queue/page-menu";
import { Hotkeys, Palette } from "@/components/queue/palette";
import { AddPlayerDialog, EditPlayerDialog } from "@/components/queue/player-dialogs";
import { QueueTab } from "@/components/queue/queue-tab";
import { RevealDriver } from "@/components/queue/reveal";
import { SanctionDialog } from "@/components/queue/sanction-dialog";
import { SettingsTab } from "@/components/queue/settings-tab";
import { QueueProvider, useQueue } from "@/components/queue/store";
import { TeamsTab } from "@/components/queue/teams-tab";
import { LAST_CHANNEL_COOKIE, TAB_COOKIE, type Tab } from "@/components/queue/tabs";
import { HistoryTab } from "@/components/queue/history-tab";
import { enter, type SanctionDraft, SearchRefContext, UiContext } from "@/components/queue/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Labels } from "@/lib/i18n";
import { useNow } from "@/components/use-now";
import { SLIDE, useSlide } from "@/components/use-slide";
import { cn } from "@/lib/utils";
import type { DashboardActions, Player, QueueState } from "@/types/queue";

type Account = { name: string; image: string | null };

export function Dashboard({ initial, me, account, tab, actions }: {
  initial: QueueState;
  me: number;
  account: Account;
  tab: Tab;
  actions: DashboardActions;
}) {
  return (
    <QueueProvider initial={initial} me={me} actions={actions}>
      <ChannelLabels>
        <Shell initialTab={tab} account={account} />
      </ChannelLabels>
    </QueueProvider>
  );
}

// The streamer's label overrides apply live: a Settings save re-renders every label.
function ChannelLabels({ children }: { children: React.ReactNode }) {
  const labels = useQueue((v) => v.settings.labels) as Labels;
  return <I18nProvider labels={labels}>{children}</I18nProvider>;
}

const ICONS = { queue: ListOrdered, teams: Swords, moderation: ShieldAlert, history: HistoryIcon, settings: Settings2 } as const;
const ORDER: Tab[] = ["queue", "teams", "moderation", "history", "settings"];

function Shell({ initialTab, account }: { initialTab: Tab; account: Account }) {
  const { t } = useT();
  const role = useQueue((v) => v.role);
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
    document.cookie = `${LAST_CHANNEL_COOKIE}=${slug}; path=/; max-age=31536000; samesite=lax`;
    return () => clearTimeout(id);
  }, [slug]);

  useEffect(() => {
    document.title = `${t(`tab.${tab}`)} · TheAtlas Queue`;
  }, [tab, t]);

  // ?tab= in the URL, and a cookie so the server renders the same tab next time.
  const setTab = useCallback((next: Tab) => {
    setDir(Math.sign(ORDER.indexOf(next) - ORDER.indexOf(tabRef.current)));
    tabRef.current = next;
    setTabState(next);
    document.cookie = `${TAB_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }, []);

  if (lost) return <NotMember />;

  // Settings is not a tab (owner, 2026-09-23): the top bar's gear, the account menu, the page menu
  // and the palette open it.
  const tabs: Tab[] = ["queue", "teams", "moderation", "history"];
  const counts: Record<Tab, number> = { queue: count, teams: playing, moderation: sanctions, history: 0, settings: 0 };
  const e2 = enter(entering, 2);
  // Only the arriving panel slides in. Given to the leaving one too, its animation kept Radix
  // from unmounting it, so it sat under the new panel for ~240ms (owner, 2026-09-27).
  const panel = (v: Tab) =>
    entering || dir === 0 || v !== tab ? {} : { className: "tab-in", style: { "--tab-from": `${dir * 16}px` } as React.CSSProperties };
  const active = tabs.indexOf(tab);

  return (
    <UiContext.Provider value={{ tab, setTab, palette, setPalette, adding, setAdding, addTo, setAddTo, addAt, setAddAt, editing, setEditing, sanction, setSanction, focusSearch, entering, account }}>
      <SearchRefContext.Provider value={search}>
      <PageMenu>
      {/* The top bar runs the full width on its own ground (August's header); its content keeps
          the page's width. It sticks while the page scrolls. */}
      <div className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto w-full max-w-[1440px] px-8 py-3 max-md:px-4">
          <TopBar />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-8 pt-8 pb-4 max-md:px-4 max-md:pt-6 max-md:pb-28">
        <Masthead />
        {offline && (
          <div role="status" className="rounded-lg border border-warning/45 px-4 py-2.5 text-meta text-foreground">
            {t("offline.banner")}
          </div>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-6">
          {/* Full width, equal tabs (August). A raised card slides under the active tab; each tab
              carries its icon (gold when active, tilting on hover like the buttons) and a live count
              (players, in teams, active sanctions) when there is one. Arrow keys move between tabs
              (Radix). */}
          <TabsList
            ref={track}
            variant="line"
            style={e2.style}
            className={cn("relative h-auto! w-full gap-1.5 rounded-xl! bg-muted p-1.5 max-md:hidden dark:bg-card", e2.className)}
          >
            <span ref={box} aria-hidden className={cn(SLIDE, "inset-y-1.5 rounded-lg bg-card shadow-sm ring-1 ring-border dark:bg-accent")} />
            {tabs.map((k) => {
              const Icon = ICONS[k];
              return (
                <TabsTrigger
                  key={k}
                  value={k}
                  className="group/tab h-12 flex-1 gap-2 rounded-lg px-5 text-body text-muted-foreground select-none after:hidden hover:text-foreground data-[state=active]:text-foreground"
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
          {role === "owner" && (
            <TabsContent value="settings" {...panel("settings")}>
              <SettingsTab />
            </TabsContent>
          )}
        </Tabs>
        {/* The credit August carried (its hover easter egg stays removed, spec D14). */}
        <footer className="mt-auto pt-6 text-center text-caption tracking-wider text-muted-foreground/60 uppercase select-none">
          Atlas Ata KAHRAMAN
        </footer>
      </div>
      </PageMenu>

      <AddPlayerDialog />
      <EditPlayerDialog />
      <SanctionDialog />
      <Palette />
      <ConfirmHost />
      <Hotkeys />
      <RevealDriver />

      {/* Mobile: the tabs move to a bottom bar (DESIGN.md § Mobile). */}
      <nav
        aria-label={t("tab.nav")}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {/* A pill slides behind the active icon (a quarter of the bar per tab); it fades on Settings. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 w-1/4 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
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
