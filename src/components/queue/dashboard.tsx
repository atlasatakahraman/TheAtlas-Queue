"use client";
import { ListOrdered, Settings2, ShieldAlert, Swords } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { I18nProvider, useT } from "@/components/i18n";
import { Masthead } from "@/components/queue/masthead";
import { ModerationTab } from "@/components/queue/moderation-tab";
import { NotMember } from "@/components/queue/not-member";
import { Hotkeys, Palette } from "@/components/queue/palette";
import { AddPlayerDialog, EditPlayerDialog } from "@/components/queue/player-dialogs";
import { QueueTab } from "@/components/queue/queue-tab";
import { RevealDriver } from "@/components/queue/reveal";
import { SanctionDialog } from "@/components/queue/sanction-dialog";
import { SettingsTab } from "@/components/queue/settings-tab";
import { QueueProvider, useQueue } from "@/components/queue/store";
import { TeamsTab } from "@/components/queue/teams-tab";
import { LAST_CHANNEL_COOKIE, TAB_COOKIE, type Tab } from "@/components/queue/tabs";
import { enter, type SanctionDraft, SearchRefContext, UiContext } from "@/components/queue/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Labels } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DashboardActions, Player, QueueState } from "@/types/queue";

export function Dashboard({ initial, me, tab, actions }: { initial: QueueState; me: number; tab: Tab; actions: DashboardActions }) {
  return (
    <QueueProvider initial={initial} me={me} actions={actions}>
      <ChannelLabels>
        <Shell initialTab={tab} />
      </ChannelLabels>
    </QueueProvider>
  );
}

// The streamer's label overrides apply live: a Settings save re-renders every label.
function ChannelLabels({ children }: { children: React.ReactNode }) {
  const labels = useQueue((v) => v.settings.labels) as Labels;
  return <I18nProvider labels={labels}>{children}</I18nProvider>;
}

const ICONS = { queue: ListOrdered, teams: Swords, moderation: ShieldAlert, settings: Settings2 } as const;

function Shell({ initialTab }: { initialTab: Tab }) {
  const { t } = useT();
  const role = useQueue((v) => v.role);
  const slug = useQueue((v) => v.channel.slug);
  const lost = useQueue((v) => v.lost);
  const count = useQueue((v) => v.players.length);
  const offline = useQueue((v) => !v.online || v.conn === "down");
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [palette, setPalette] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  const [sanction, setSanction] = useState<SanctionDraft | null>(null);
  const [entering, setEntering] = useState(true);
  const search = useRef<HTMLInputElement>(null);
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
    setTabState(next);
    document.cookie = `${TAB_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }, []);

  if (lost) return <NotMember />;

  const tabs: Tab[] = role === "owner" ? ["queue", "teams", "moderation", "settings"] : ["queue", "teams", "moderation"];
  const e2 = enter(entering, 2);

  return (
    <UiContext.Provider value={{ tab, setTab, palette, setPalette, adding, setAdding, editing, setEditing, sanction, setSanction, focusSearch, entering }}>
      <SearchRefContext.Provider value={search}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-6 px-8 py-10 max-md:px-4 max-md:pt-6 max-md:pb-28">
        <Masthead />
        {offline && (
          <div role="status" className="rounded-lg border border-warning/45 px-4 py-2.5 text-meta text-foreground">
            {t("offline.banner")}
          </div>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-6">
          <TabsList variant="underline" style={e2.style} className={cn("w-full justify-start max-md:hidden", e2.className)}>
            {tabs.map((k) => (
              <TabsTrigger key={k} value={k} className="flex-none px-4 py-2.5 text-control select-none">
                {t(`tab.${k}`)}
                {k === "queue" && <span className="text-muted-foreground tabular-nums">{count}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="queue">
            <QueueTab />
          </TabsContent>
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
          <TabsContent value="moderation">
            <ModerationTab />
          </TabsContent>
          {role === "owner" && (
            <TabsContent value="settings">
              <SettingsTab />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <AddPlayerDialog />
      <EditPlayerDialog />
      <SanctionDialog />
      <Palette />
      <Hotkeys />
      <RevealDriver />

      {/* Mobile: the tabs move to a bottom bar (DESIGN.md § Mobile). */}
      <nav
        aria-label={t("tab.nav")}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {tabs.map((k) => {
          const Icon = ICONS[k];
          return (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? "page" : undefined}
              onClick={() => setTab(k)}
              className={cn(
                "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-caption tracking-normal normal-case select-none",
                tab === k ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {t(`tab.${k}`)}
            </button>
          );
        })}
      </nav>
      </SearchRefContext.Provider>
    </UiContext.Provider>
  );
}
