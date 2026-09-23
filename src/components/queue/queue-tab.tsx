"use client";
import { MessageSquareText, Search } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useT } from "@/components/i18n";
import { PlayerRow } from "@/components/queue/player-row";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { enter, SearchRefContext, useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useStored } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { isLabelKey } from "@/lib/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Activity, Player } from "@/types/queue";

const FILTERS = ["all", "waiting", "playing", "away"] as const;
type Filter = (typeof FILTERS)[number];

// Splits a label around {command} so the command renders in mono: it is literally typed.
export function WithCommand({ text, command }: { text: string; command: string }) {
  const [a, b] = text.split("{command}");
  if (b === undefined) return <>{text}</>;
  return (
    <>
      {a}
      <code className="font-mono text-code text-foreground select-all">{command}</code>
      {b}
    </>
  );
}

export function QueueTab() {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const players = useQueue((v) => v.players);
  const arrived = useQueue((v) => v.arrived);
  const reverted = useQueue((v) => v.reverted);
  const command = useQueue((v) => v.settings.join_command);
  const [filter, setFilter] = useStored<Filter>("queue.filter", "all", FILTERS);
  const [query, setQuery] = useState("");
  const searchRef = useContext(SearchRefContext);

  const counts = useMemo(() => {
    const c = { all: players.length, waiting: 0, playing: 0, away: 0 };
    for (const p of players) c[p.status]++;
    return c;
  }, [players]);
  const q = query.trim().toLowerCase();
  const shown = players
    .map((p, i) => ({ p, n: i + 1 }))
    .filter(
      ({ p }) =>
        (filter === "all" || p.status === filter) &&
        (!q || p.kick_username.toLowerCase().includes(q) || p.riot_id?.toLowerCase().includes(q)),
    );
  const e3 = enter(ui.entering, 3);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6 max-lg:grid-cols-1">
      <section className="flex min-w-0 flex-col gap-4">
        <div style={e3.style} className={cn("flex flex-wrap items-end justify-between gap-4", e3.className)}>
          <div className="min-w-0">
            <h2 className="font-serif text-title">{t("queue.title")}</h2>
            <p className="text-meta text-muted-foreground">
              <WithCommand text={t("queue.hint")} command={command} />
            </p>
          </div>
          <Button size="lg" className="max-md:hidden" disabled={!canWrite} onClick={() => ui.setAdding(true)}>
            {t("action.add")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label={t("filter.label")}
            className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 select-none max-md:w-full"
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-control outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11",
                  filter === f ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`filter.${f}`)}
                <span className="text-muted-foreground tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto max-md:ml-0 max-md:w-full">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("queue.search")}
              aria-label={t("queue.search")}
              className="h-9 w-64 pl-9 max-md:h-11 max-md:w-full"
            />
          </div>
        </div>

        {players.length === 0 ? (
          <div className="flex flex-col gap-1 py-10">
            <p className="font-serif text-title">{t("queue.empty.title")}</p>
            <p className="text-muted-foreground">
              <WithCommand text={t("queue.empty.hint")} command={`${command} Name#TAG`} />
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-10 text-muted-foreground">{t("queue.none_match")}</p>
        ) : (
          <div data-rows className="flex flex-col gap-1.5">
            {shown.map(({ p, n }, i) => (
              <PlayerRow
                key={p.id}
                player={p}
                number={n}
                arrivedAt={arrived[p.id]}
                revertedAt={reverted[p.id]}
                enterStyle={i < 12 ? enter(ui.entering, 4 + i) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-4 max-lg:hidden">
        <Stats players={players} />
        <section className="rounded-xl bg-card p-4">
          <h3 className="mb-3 text-caption text-muted-foreground uppercase select-none">{t("feed.title")}</h3>
          <Feed />
        </section>
      </aside>

      <MobileFeed />
      <Button
        size="lg"
        className="fixed inset-x-4 bottom-20 z-30 h-11 shadow-lg md:hidden"
        disabled={!canWrite}
        onClick={() => ui.setAdding(true)}
      >
        {t("action.add")}
      </Button>
    </div>
  );
}

function Stats({ players }: { players: Player[] }) {
  const { t } = useT();
  const s = useMemo(() => {
    const c = { waiting: 0, playing: 0, away: 0, games: 0 };
    for (const p of players) {
      c[p.status]++;
      c.games += p.games_played;
    }
    return c;
  }, [players]);
  return (
    <dl className="grid grid-cols-2 gap-1.5">
      {(["waiting", "playing", "away", "games"] as const).map((k) => (
        <div key={k} className="rounded-xl bg-card p-4">
          <dt className="text-meta text-muted-foreground">{t(`stat.${k}`)}</dt>
          <dd className="font-serif text-title tabular-nums">{s[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

const CHAT_ACTIONS = new Set(["chat_join", "chat_rejected", "chat_leave", "chat_away", "stream_live", "stream_offline"]);

function useChatLines(): Activity[] {
  const activity = useQueue((v) => v.activity);
  return useMemo(() => activity.filter((a) => a.actor === null && CHAT_ACTIONS.has(a.action)).slice(0, 40), [activity]);
}

// From chat (DESIGN.md § Toasts versus the feed): chat events land here and as the row
// highlight, never as a toast.
function Feed() {
  const { t } = useT();
  const lines = useChatLines();
  const now = useNow();
  if (lines.length === 0) return <p className="text-meta text-muted-foreground">{t("feed.empty")}</p>;
  return (
    <ol className="flex flex-col gap-2.5">
      {lines.map((a) => {
        const name = <span className="font-semibold">{a.target}</span>;
        const reason = `reason.${String(a.payload.reason ?? "")}`;
        return (
          <li key={a.id} className="flex flex-col text-meta">
            <span className={cn(a.action === "chat_rejected" && "text-destructive selection:bg-destructive selection:text-background")}>
              {a.action === "chat_join" && <>{name} {t("feed.joined")}</>}
              {a.action === "chat_rejected" && (
                <>
                  {name} {t("feed.rejected")}
                  {isLabelKey(reason) && `: ${t(reason)}`}
                </>
              )}
              {a.action === "chat_leave" && <>{name} {t("feed.left")}</>}
              {a.action === "chat_away" && <>{name} {a.payload.status === "away" ? t("feed.away") : t("feed.back")}</>}
              {a.action === "stream_live" && t("feed.live")}
              {a.action === "stream_offline" && t("feed.offline")}
            </span>
            <span className="flex gap-2 text-muted-foreground">
              {typeof a.payload.riot_id === "string" && <code className="font-mono text-code select-all">{a.payload.riot_id}</code>}
              <span>{now ? ago(a.created_at, now, t) : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Under 1024px the feed moves into a bottom Sheet behind a From chat button with an unread count.
function MobileFeed() {
  const { t } = useT();
  const lines = useChatLines();
  const newest = lines[0]?.id ?? 0;
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(newest);
  const unread = lines.filter((a) => a.id > seen).length;
  return (
    <div className="lg:hidden">
      <Button variant="outline" size="lg" className="h-11" onClick={() => (setSeen(newest), setOpen(true))}>
        <MessageSquareText aria-hidden />
        {t("feed.title")}
        {unread > 0 && <span className="rounded-full bg-accent px-2 tabular-nums">{unread}</span>}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setSeen(newest);
        }}
      >
        <SheetContent side="bottom" className="max-h-[80dvh] gap-4 overflow-y-auto rounded-t-2xl p-6">
          <SheetHeader className="p-0">
            <SheetTitle className="font-serif text-title font-normal">{t("feed.title")}</SheetTitle>
          </SheetHeader>
          <Feed />
        </SheetContent>
      </Sheet>
    </div>
  );
}
