"use client";
import { ArrowDown, ArrowUp, Copy, Ellipsis, Search, SquareArrowOutUpRight, Trash2, Trophy, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { confirm } from "@/components/queue/confirm";
import { FilterPills } from "@/components/queue/filter-pills";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useStored } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { db } from "@/lib/supabase/browser";
import { span } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Game, PlayerRecord } from "@/types/queue";
import { GAME_ROW, GAMES_SEARCH } from "@/components/queue/geometry";

// Games (DESIGN.md § Games tab, D27): the score as the title, then Games (one line a game, newest
// first, 50 more on scroll) or Stats (every name's record), and a name search for both.
const VIEWS = ["games", "stats"] as const;
// This stream's games and stats, or every kept game's (owner, 2026-09-28): each its own history.
const SCOPES = ["stream", "all"] as const;
type Scope = (typeof SCOPES)[number];
const PAGE = 50;

export function GamesTab() {
  const { t } = useT();
  const ui = useUi();
  const act = useAct();
  const role = useQueue((v) => v.role);
  const canWrite = useCanWrite();
  const score = useQueue((v) => v.score);
  const epoch = useQueue((v) => v.gamesEpoch);
  const any = useQueue((v) => v.games.length > 0);
  const [view, setView] = useStored<(typeof VIEWS)[number]>("queue.games-view", "games", VIEWS);
  const [scope, setScope] = useStored<Scope>("queue.games-scope", "stream", SCOPES);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const e3 = enter(ui.entering, 3);
  const e4 = enter(ui.entering, 4);

  const clearGames = async () => {
    const ask = { title: t("confirm.clear_games.title"), body: t("confirm.clear_games.body"), action: t("games.clear") };
    if (await confirm(ask)) void act("clear_games", {}, { done: "done.clear_games" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div style={e3.style} className={cn("flex flex-wrap items-end justify-between gap-4", e3.className)}>
        {/* The score is the title once a game is recorded (DESIGN.md § Games tab). */}
        <h2 className="font-serif text-title">
          {score.t1 + score.t2 > 0 ? (
            <>
              {/* The numbers alone, in the team colours (owner, 2026-09-28). */}
              <span className="text-team-1 tabular-nums">{score.t1}</span> <span className="text-muted-foreground">–</span>{" "}
              <span className="text-team-2 tabular-nums">{score.t2}</span>
            </>
          ) : (
            t("tab.games")
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          <FilterPills
            label={t("games.view")}
            value={view}
            onChange={setView}
            options={VIEWS.map((v) => ({ value: v, label: t(`games.view.${v}`) }))}
          />
          <FilterPills
            label={t("games.scope")}
            value={scope}
            onChange={setScope}
            options={SCOPES.map((s) => ({ value: s, label: t(`games.scope.${s}`) }))}
          />
          <div className="relative max-md:w-full">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("games.search")}
              aria-label={t("games.search")}
              className={GAMES_SEARCH}
            />
          </div>
          {/* Streamer only, as Clear history; asks first, and Undo brings the games back. */}
          {role === "owner" && (
            <Button variant="destructive" size="lg" className="max-md:h-11" disabled={!canWrite || !any} onClick={() => void clearGames()}>
              <Trash2 aria-hidden />
              {t("games.clear")}
            </Button>
          )}
        </div>
      </div>
      <div style={e4.style} className={e4.className}>
        {/* A clear, or its Undo, reads the newest games again: the list starts over with it. */}
        {view === "games" ? <GameList key={`${epoch}-${scope}`} query={q} since={scope === "stream" ? score.since : null} /> : <Stats query={q} since={scope === "stream" ? score.since : null} />}
      </div>
    </div>
  );
}

function RowSkeleton() {
  return <Skeleton className={cn(GAME_ROW, "w-full rounded-xl")} />;
}

function Failed({ retry }: { retry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 py-6 text-muted-foreground">
      {t("games.error")}
      <Button variant="outline" onClick={retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

function GameList({ query, since }: { query: string; since: string | null }) {
  const { t } = useT();
  const store = useStore();
  const channel = useQueue((v) => v.channel.id);
  const games = useQueue((v) => v.games);
  // The snapshot carries the newest 20; fewer means there is nothing older to read.
  const [more, setMore] = useState<"idle" | "loading" | "error" | "done">(() => (store.get().games.length < 20 ? "done" : "idle"));
  const [found, setFound] = useState<{ q: string; rows: Game[] | null }>({ q: "", rows: null });
  const [retry, setRetry] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    const last = store.get().games.at(-1);
    const oldest = last?.n;
    // This stream's list ends where the stream began.
    if (oldest === undefined || (since && last!.ended_at < since)) return setMore("done");
    setMore("loading");
    const { data, error } = await db()
      .from("games")
      .select("*")
      .eq("channel_id", channel)
      .is("removed_at", null)
      .lt("n", oldest)
      .order("n", { ascending: false })
      .limit(PAGE);
    if (error) return setMore("error");
    store.addGames(data as Game[]);
    setMore(data.length < PAGE ? "done" : "idle");
  }, [channel, store, since]);

  // Keyset paging as the end of the list comes near; a new observer reports at once, so a short
  // page that leaves the end in view reads the next one.
  useEffect(() => {
    if (query || more !== "idle" || !end.current) return;
    const io = new IntersectionObserver(([e]) => void (e.isIntersecting && loadMore()), { rootMargin: "200px" });
    io.observe(end.current);
    return () => io.disconnect();
  }, [query, more, loadMore]);

  // A name keeps the games that player was in, read from the server (the list holds only what has
  // been paged in). Read again when a game is recorded or removed.
  // ponytail: the newest 50 matches only; page the search too if a name ever has more.
  useEffect(() => {
    if (!query) return;
    let live = true;
    const id = setTimeout(async () => {
      let read = db()
        .from("games")
        .select("*, game_players!inner()")
        .eq("channel_id", channel)
        .is("removed_at", null)
        .ilike("game_players.name", `%${query}%`);
      if (since) read = read.gte("ended_at", since);
      const { data, error } = await read.order("n", { ascending: false }).limit(PAGE);
      if (live) setFound({ q: query, rows: error ? null : (data as Game[]) });
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, channel, games, retry, since]);

  const rows = query ? (found.q === query ? found.rows : undefined) : since ? games.filter((g) => g.ended_at >= since) : games;
  if (rows === null) return <Failed retry={() => setRetry((n) => n + 1)} />;
  if (rows === undefined)
    return (
      <div className="flex flex-col gap-1.5">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  if (rows.length === 0) return <p className="py-10 text-muted-foreground">{query ? t("games.search.none", { name: query }) : t(since ? "games.empty.stream" : "games.empty")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-col gap-1.5">
        {rows.map((g) => (
          <GameRow key={g.id} game={g} />
        ))}
      </ol>
      {!query && more === "loading" && <RowSkeleton />}
      {!query && more === "error" && <Failed retry={() => void loadMore()} />}
      <div ref={end} />
    </div>
  );
}

// One line (owner, 2026-09-28): the number, a trophy and the winner's current name, the size, the
// end time and the length. The whole row opens the game's page; ⋯ sits above that link.
function GameRow({ game }: { game: Game }) {
  const { t, lang } = useT();
  const now = useNow();
  const slug = useQueue((v) => v.channel.slug);
  const href = `/c/${slug}/games/${game.n}`;
  const ended = new Date(game.ended_at);
  // Times are the viewer's own, so they wait for the clock; an older day shows its date.
  const today = now && new Date(now).toDateString() === ended.toDateString();
  const time = now
    ? new Intl.DateTimeFormat(lang, today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ended)
    : null;
  const length = game.started_at ? span(Math.max(60_000, ended.getTime() - Date.parse(game.started_at)), t) : null;
  const tone = game.winner === 1 ? "text-team-1" : "text-team-2";
  return (
    <li
      className={cn(
        GAME_ROW,
        "relative grid grid-cols-[3rem_minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 rounded-xl border border-l-[3px] border-row-edge bg-row pr-2 pl-4 transition-colors hover:bg-accent/60 max-sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]",
        game.winner === 1 ? "border-l-team-1" : "border-l-team-2",
      )}
    >
      <span className="font-serif text-numeral text-muted-foreground tabular-nums">#{game.n}</span>
      <Link
        href={href}
        className="flex min-w-0 items-center gap-2 text-name outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
      >
        <Trophy aria-hidden className={cn("size-4 shrink-0", tone)} />
        <span className={cn("truncate font-medium", tone)}>{t(`team.${game.winner}`)}</span>
      </Link>
      <span className="text-meta text-muted-foreground tabular-nums max-sm:hidden">{gameSize(game, t)}</span>
      <span className="flex items-baseline gap-4 text-meta whitespace-nowrap text-muted-foreground tabular-nums">
        <time dateTime={game.ended_at}>{time}</time>
        {length && <span className="max-sm:hidden">{length}</span>}
      </span>
      <GameMenu game={game} href={href} />
    </li>
  );
}

// As the rosters stood (a 4 v 4 on a 5-a-side setting reads 4 v 4).
export function gameSize(game: Game, t: ReturnType<typeof useT>["t"]) {
  return t("games.size", { a: game.teams[0].length, b: game.teams[1].length });
}

// A win and a loss count (owner, 2026-09-28: "too colourless"): the figures in Newsreader as the
// counts, wins in gold (the trophy's) and losses in red, a zero muted; the letters stay muted. Not
// the team colours: teal and orange always mean a team (DESIGN.md § Colour means something).
export const WIN = (n: number) => cn("font-serif text-body font-medium tabular-nums", n > 0 ? "text-brand" : "text-muted-foreground");
export const LOSS = (n: number) => cn("font-serif text-body font-medium tabular-nums", n > 0 ? "text-destructive" : "text-muted-foreground");

// A label such as "{w} W {l} L" with its figures coloured.
export function WinLoss({ text, w, l }: { text: string; w: number; l: number }) {
  return text.split(/(\{w\}|\{l\})/).map((part, i) =>
    part === "{w}" ? (
      <span key={i} className={WIN(w)}>
        {w}
      </span>
    ) : part === "{l}" ? (
      <span key={i} className={LOSS(l)}>
        {l}
      </span>
    ) : (
      part
    ),
  );
}

export function copyResult(game: Game, t: ReturnType<typeof useT>["t"]) {
  const names = (i: 0 | 1) => game.teams[i].flatMap((e) => (e.removed ? [] : [e.kick_username])).join(", ");
  const text = [t("games.result", { n: game.n, team: t(`team.${game.winner}`) }), `${t("team.1")}: ${names(0)}`, `${t("team.2")}: ${names(1)}`].join("\n");
  void navigator.clipboard.writeText(text).then(() => toast(t("games.copied")));
}

function GameMenu({ game, href }: { game: Game; href: string }) {
  const { t } = useT();
  const act = useAct();
  const router = useRouter();
  const canWrite = useCanWrite();
  const label = t("games.menu", { n: game.n });
  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative z-10 max-md:size-11" aria-label={label}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-52 p-1.5">
        <DropdownMenuItem onSelect={() => router.push(href)}>
          <SquareArrowOutUpRight aria-hidden />
          {t("games.open")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyResult(game, t)}>
          <Copy aria-hidden />
          {t("games.copy")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Undoable from the toast, so it does not ask first (as removing a player). */}
        <DropdownMenuItem
          variant="destructive"
          disabled={!canWrite}
          onSelect={() => void act("remove_game", { p_game: game.id }, { done: "done.remove_game", vars: { n: game.n } })}
        >
          <Trash2 aria-hidden />
          {t("games.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type StatKey = "name" | "games" | "wins" | "losses" | "winrate" | "streak";
const MINS = ["1", "3", "5", "10"] as const;
const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

function statValue(r: PlayerRecord, key: StatKey): number | string {
  const n = r.wins + r.losses;
  return key === "name" ? r.name : key === "games" ? n : key === "wins" ? r.wins : key === "losses" ? r.losses : key === "winrate" ? r.wins / (n || 1) : r.streak;
}

// This stream's records, counted here from its games' players; or every name's record over the
// kept games (player_records). Read when the tab opens and again whenever a game changes.
function streamRecords(rows: { name: string; won: boolean; games: { n: number; ended_at: string } }[]): PlayerRecord[] {
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  return [...by].map(([name, list]) => {
    list.sort((a, b) => a.games.n - b.games.n);
    let streak = 0;
    let run = 0;
    let best = 0;
    for (const r of list) {
      streak = r.won ? (streak > 0 ? streak + 1 : 1) : streak < 0 ? streak - 1 : -1;
      run = r.won ? run + 1 : 0;
      best = Math.max(best, run);
    }
    const wins = list.filter((r) => r.won).length;
    return { name, wins, losses: list.length - wins, streak, best, last_game_at: list.at(-1)!.games.ended_at };
  });
}

function Stats({ query, since }: { query: string; since: string | null }) {
  const { t } = useT();
  const act = useAct();
  const channel = useQueue((v) => v.channel.id);
  const games = useQueue((v) => v.games);
  const owner = useQueue((v) => v.role === "owner");
  const canWrite = useCanWrite();
  const [records, setRecords] = useState<PlayerRecord[] | null | undefined>(undefined);
  const [retry, setRetry] = useState(0);
  const [min, setMin] = useStored<(typeof MINS)[number]>("queue.stats-min", "1", MINS);
  const [sort, setSort] = useState<{ key: StatKey; dir: 1 | -1 }>({ key: "wins", dir: -1 });

  useEffect(() => {
    let live = true;
    // ponytail: one read of up to 1000 names; page it if a channel's history ever outgrows that.
    if (since)
      void db()
        .from("game_players")
        .select("name, won, games!inner(n, ended_at)")
        .eq("channel_id", channel)
        .is("games.removed_at", null)
        .gte("games.ended_at", since)
        .limit(5000)
        .then(({ data, error }) => live && setRecords(error ? null : streamRecords(data as unknown as Parameters<typeof streamRecords>[0])));
    else
      void db()
        .from("player_records")
        .select("*")
        .eq("channel_id", channel)
        .limit(1000)
        .then(({ data, error }) => live && setRecords(error ? null : (data as PlayerRecord[])));
    return () => {
      live = false;
    };
  }, [channel, games, retry, since]);

  const rows = useMemo(
    () =>
      records
        ?.filter((r) => r.wins + r.losses >= Number(min) && (!query || r.name.includes(query)))
        .sort((a, b) => {
          const x = statValue(a, sort.key);
          const y = statValue(b, sort.key);
          const c = typeof x === "string" ? collator.compare(x, y as string) : x - (y as number);
          return c * sort.dir || collator.compare(a.name, b.name);
        }),
    [records, min, query, sort],
  );

  if (records === null) return <Failed retry={() => setRetry((n) => n + 1)} />;
  if (records === undefined)
    return (
      <div className="flex flex-col gap-1.5">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  if (records.length === 0) return <p className="py-10 text-muted-foreground">{t("stats.empty")}</p>;

  const mostWins = records.reduce((a, b) => (b.wins > a.wins ? b : a));
  const longest = records.reduce((a, b) => (b.best > a.best ? b : a));
  const forget = async (name: string) => {
    const ask = { title: t("confirm.forget.title", { name }), body: t("confirm.forget.body"), action: t("stats.forget") };
    if (await confirm(ask)) void act("forget_player", { p_name: name }, { done: "done.forget_player", vars: { name } });
  };
  const th = "text-caption text-muted-foreground uppercase select-none";
  const col = (key: StatKey, label: string, className?: string) => {
    const on = sort.key === key;
    const Arrow = sort.dir === -1 ? ArrowDown : ArrowUp;
    return (
      <span className={className}>
        <button
          type="button"
          // The first click: names A to Z, every count highest first; the same column again flips.
          onClick={() => setSort({ key, dir: on ? (-sort.dir as 1 | -1) : key === "name" ? 1 : -1 })}
          aria-label={on ? t(sort.dir === -1 ? "sort.by.desc" : "sort.by.asc", { col: label }) : t("sort.by", { col: label })}
          className={cn(th, "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40", on && "text-foreground")}
        >
          {label}
          {on && <Arrow aria-hidden className="size-3.5" />}
        </button>
      </span>
    );
  };
  const grid = cn(
    "grid items-center gap-x-4 px-4",
    owner
      ? "grid-cols-[minmax(0,1fr)_4rem_2.5rem_2.5rem_5rem_6rem_2.25rem] max-sm:grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_4rem_2.75rem]"
      : "grid-cols-[minmax(0,1fr)_4rem_2.5rem_2.5rem_5rem_6rem] max-sm:grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_4rem]",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {[
          { label: t("stats.most_wins"), name: mostWins.name, value: mostWins.wins === 1 ? t("stats.tile.win") : t("stats.tile.wins", { n: mostWins.wins }) },
          { label: t("stats.longest"), name: longest.name, value: t("stats.tile.streak", { n: longest.best }) },
        ].map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded-xl bg-card p-4">
            <span className="text-meta text-muted-foreground">{tile.label}</span>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate font-serif text-title">{tile.name}</span>
              <span className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">{tile.value}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="self-start max-md:self-stretch">
        <FilterPills
        label={t("stats.min")}
        value={min}
        onChange={setMin}
        options={MINS.map((m) => ({ value: m, label: m === "1" ? t("filter.all") : t("stats.min.n", { n: m }) }))}
        />
      </div>
      <div className="rounded-xl bg-card py-2">
        <div className={cn(grid, "h-9")}>
          {col("name", t("col.player"))}
          {col("games", t("col.games"), "max-sm:hidden")}
          {col("wins", t("col.wins"))}
          {col("losses", t("col.losses"))}
          {col("winrate", t("col.winrate"))}
          {col("streak", t("col.streak"), "max-sm:hidden")}
          {owner && <span />}
        </div>
        {rows?.length === 0 ? (
          <p className="px-4 py-6 text-muted-foreground">{query ? t("games.search.none", { name: query }) : t("stats.empty")}</p>
        ) : (
          <ol>
            {rows?.map((r) => {
              const n = r.wins + r.losses;
              return (
                <li key={r.name} className={cn(grid, "min-h-11 py-1 text-body tabular-nums transition-colors hover:bg-accent/60")}>
                  <span className="truncate text-name">{r.name}</span>
                  <span className="max-sm:hidden">{n}</span>
                  <span className={WIN(r.wins)}>{r.wins}</span>
                  <span className={LOSS(r.losses)}>{r.losses}</span>
                  <span>{Math.round((r.wins / (n || 1)) * 100)}%</span>
                  <span className={cn("max-sm:hidden", r.streak > 0 ? "text-brand" : "text-muted-foreground")}>
                    {r.streak > 0 ? t("stats.streak.won", { n: r.streak }) : r.streak < 0 ? t("stats.streak.lost", { n: -r.streak }) : null}
                  </span>
                  {owner && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("stats.menu", { name: r.name })}>
                          <Ellipsis aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-56 p-1.5">
                        <DropdownMenuItem variant="destructive" disabled={!canWrite} onSelect={() => void forget(r.name)}>
                          <UserX aria-hidden />
                          {t("stats.forget")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
