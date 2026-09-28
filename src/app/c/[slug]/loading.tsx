import { ChevronDown, Dices, Plus, Shuffle, Trash2, Trophy, UserPlus } from "lucide-react";
import { cookies } from "next/headers";
import {
  CARD_HEAD,
  COLS,
  COLS_COOKIE,
  type Cols,
  DAY,
  DAY_HEAD,
  GAME_ROW,
  GAMES_SEARCH,
  LINE,
  MAIN,
  MASTHEAD,
  MID,
  MOD_COLS,
  MOD_ROW,
  PICKS_COOKIE,
  PILL,
  PILL_TRACK,
  QUEUE_GRID,
  ROW,
  ROW_BUTTONS,
  ROW_ROSTER,
  SEARCH,
  SECTION,
  SECTION_CARD,
  SHADE,
  TAB,
  TAB_TRACK,
  TABLE_HEAD,
  tableCols,
  TEAMS_BAR,
  TEAMS_BAR_BUTTONS,
  TEAMS_GRID,
  TOOLBAR,
  WIDE,
} from "@/components/queue/geometry";
import { TAB_COOKIE, TABS, type Tab } from "@/components/queue/tabs";
import { Button } from "@/components/ui/button";
import { Shade, TopBarSkeleton } from "@/components/queue/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { LANG_COOKIE, type LabelKey, parseLang, translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// While the dashboard loader runs (get_state, and a Kick subscription repair when due): the
// chrome, then the tab being opened (DESIGN.md § States → Loading; owner, 2026-09-27: each page
// and tab its own skeleton). Owner, 2026-09-28 (10.10): the exact width, height and behaviour of
// the page at every size. So every box is built from the page's own classes (geometry.ts), the
// controls are the page's own buttons shaded, and the words are the page's own labels drawn
// transparent, taking the room the page will. The tab and the table's columns come from the
// cookies the dashboard writes.
type T = (key: LabelKey, vars?: Record<string, string | number>) => string;
type Ctx = { t: T; cols: Cols; today: string; picks: number };

export default async function DashboardLoading() {
  const jar = await cookies();
  const q = jar.get(TAB_COOKIE)?.value;
  const tab: Tab = TABS.find((t) => t === q) ?? "queue";
  const c = jar.get(COLS_COOKIE)?.value;
  const lang = parseLang(jar.get(LANG_COOKIE)?.value) ?? "en";
  const ctx: Ctx = {
    t: (key, vars) => translate(lang, key, undefined, vars),
    cols: COLS.find((x) => x === c) ?? "plain",
    today: new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "day"),
    picks: Math.min(3, Math.max(1, Number(jar.get(PICKS_COOKIE)?.value) || 3)),
  };
  const Body = BODIES[tab];
  return (
    <div aria-busy className="flex flex-1 flex-col">
      <TopBarSkeleton />
      <div className={MAIN}>
        <header className={MASTHEAD}>
          <div />
          <Toolbar t={ctx.t} picks={ctx.picks} />
        </header>
        <div className={cn(TAB_TRACK, "flex animate-pulse")}>
          {TABS.filter((k) => k !== "settings").map((k) => (
            <span key={k} className={TAB} />
          ))}
        </div>
        <Body {...ctx} />
      </div>
      {/* Phones: the tab bar at the foot, as the dashboard's. */}
      <div className="fixed inset-x-0 bottom-0 z-40 h-16 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden" />
    </div>
  );
}

// A filter-pill track (FilterPills) with its labels and counts.
function Pills({ items }: { items: [string, string?][] }) {
  return (
    <div className={cn(PILL_TRACK, "w-fit animate-pulse")}>
      <div className="flex w-max gap-1 p-1 text-transparent select-none">
        {items.map(([label, count]) => (
          <span key={label} className={PILL}>
            {label}
            {count !== undefined && <span className="font-serif tabular-nums">{count}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// The toolbar every tab shares (toolbar.tsx), its buttons shaded.
function Toolbar({ t, picks }: { t: T; picks: number }) {
  return (
    <div aria-hidden className={TOOLBAR}>
      <Button variant="outline" size="lg" tabIndex={-1} className={cn("max-md:size-11", SHADE)}>
        <UserPlus />
        <span className="max-md:sr-only">{t("action.add")}</span>
      </Button>
      <span className="my-auto h-6 w-px max-md:hidden" />
      <span className="flex animate-pulse items-center rounded-lg border border-transparent bg-muted text-transparent select-none">
        <span className="flex items-center gap-1.5 pr-1 pl-3 text-control max-md:pl-2.5">
          <Dices className="invisible size-4" />
          <span className="max-md:sr-only">{t("pick.label")}</span>
        </span>
        {[1, 2, 3].slice(0, picks).map((n) => (
          <Button key={n} variant="ghost" size="lg" tabIndex={-1} className={cn("rounded-none px-2.5 tabular-nums max-md:h-11", SHADE, "animate-none bg-transparent")}>
            ×{n}
          </Button>
        ))}
        <span className="flex h-9 items-center gap-1.5 border-l border-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap max-md:h-11">
          {t("pick.source.waiting")}
          <ChevronDown className="invisible size-4" />
        </span>
      </span>
      <Button variant="outline" size="lg" tabIndex={-1} className={cn("max-md:size-11", SHADE)}>
        <Shuffle />
        <span className="max-md:sr-only">{t("action.shuffle")}</span>
      </Button>
      <span className="my-auto h-6 w-px max-md:hidden" />
      <Button variant="destructive" size="lg" tabIndex={-1} className={cn("max-md:size-11", SHADE)}>
        <Trash2 />
        <span className="max-md:sr-only">{t("action.clear_queue")}</span>
      </Button>
    </div>
  );
}

// A player row as player-row.tsx draws it: the same grid, cells and container rules, so its
// buttons drop to their own line where the page's do (under 40rem of table, 24rem of roster).
function Row({ cols, roster = false }: { cols: Cols; roster?: boolean }) {
  const ids = cols !== "plain";
  const ranks = cols === "ranks";
  return (
    <div className={cn(ROW, roster ? ROW_ROSTER : cn("bg-row", tableCols(ids, ranks)))}>
      <Skeleton className="h-5 w-4" />
      <span className="flex min-w-0 items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-32 max-w-full" />
      </span>
      {!roster && ids && <Skeleton className={cn("h-4 w-20", MID)} />}
      {(ranks || roster) && (
        <span className={roster ? "max-sm:hidden" : MID}>
          <Skeleton className="h-4 w-20" />
        </span>
      )}
      {!roster && ranks && (
        <span className={WIDE}>
          <Skeleton className="h-4 w-10" />
        </span>
      )}
      {!roster && (
        <span className={WIDE}>
          <Skeleton className="h-4 w-12" />
        </span>
      )}
      {/* Three quick actions and the menu: 32px, 44px on touch; the menu 44px under 768px. */}
      <span className={roster ? ROW_BUTTONS.roster : ROW_BUTTONS.table}>
        <Skeleton className="h-8 w-32 max-md:h-11 [@media(hover:none)]:h-11 [@media(hover:none)]:w-44" />
      </span>
    </div>
  );
}

function QueueBody({ t, cols }: Ctx) {
  return (
    <div className={QUEUE_GRID}>
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Shade className="font-serif text-title">{t("queue.title")}</Shade>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Pills items={(["all", "waiting", "playing", "away", "punished"] as const).map((f) => [t(`filter.${f}`), "0"])} />
          <div className="relative ml-auto max-md:ml-0 max-md:w-full">
            <Skeleton className={SEARCH} />
          </div>
        </div>
        <div className="@container flex flex-col gap-1.5">
          <div className={cn(TABLE_HEAD, tableCols(cols !== "plain", cols === "ranks"))} />
          {Array.from({ length: 6 }, (_, i) => (
            <Row key={i} cols={cols} />
          ))}
        </div>
      </section>
      <aside className="flex flex-col gap-4 max-lg:hidden">
        <div className="grid grid-cols-2 gap-1.5">
          {(["waiting", "playing", "away", "total"] as const).map((k) => (
            <div key={k} className="rounded-xl bg-card p-4">
              <Shade className="text-meta">{t(`stat.${k}`)}</Shade>
              <Shade className="font-serif text-title tabular-nums">0</Shade>
            </div>
          ))}
        </div>
        <section className="rounded-xl bg-card p-4">
          <Shade className="mb-3 text-caption uppercase">{t("feed.title")}</Shade>
          {/* A chat line is two lines (the event, then its time and Riot ID). */}
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="flex flex-col text-meta">
                <Shade className="w-4/5">&nbsp;</Shade>
                <Shade className="w-1/3">&nbsp;</Shade>
              </span>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

// The match headline, two team cards of five (Victory and Add in each header), the actions bar.
function TeamsBody({ t, cols }: Ctx) {
  const card = (team: 1 | 2) => (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card">
      <div className="h-[5px] bg-muted" />
      <div className="flex flex-col gap-3 p-4">
        <header className={CARD_HEAD}>
          <Shade>{t("teams.count", { n: 0, size: 5 })}</Shade>
          <span className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
              <Trophy />
              {t("action.victory")}
            </Button>
            <Button variant="ghost" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
              <UserPlus />
              {t("teams.add", { team: t(`team.${team}`) })}
            </Button>
          </span>
        </header>
        <div className="@container flex flex-col gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Row key={i} cols={cols} roster />
          ))}
        </div>
      </div>
    </section>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-4 font-serif text-headline max-md:text-title">
          <Shade>{t("team.1")}</Shade>
          <Shade className="text-title italic max-md:text-body">{t("match.vs")}</Shade>
          <Shade className="justify-self-end">{t("team.2")}</Shade>
        </div>
      </div>
      <div className={TEAMS_GRID}>
        {card(1)}
        <Shade className="-my-2 justify-self-center font-serif text-title italic lg:hidden">{t("match.vs")}</Shade>
        {card(2)}
      </div>
      <div className={TEAMS_BAR}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
          <span className="flex min-h-11 items-center">
            <Shade className="text-control">{t("teams.fair_play")}</Shade>
          </span>
        </div>
        <div className={TEAMS_BAR_BUTTONS}>
          <Button variant="destructive" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
            {t("action.clear_teams")}
          </Button>
          <Button variant="outline" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
            {t("action.shuffle_teams")}
          </Button>
          <Button variant="outline" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
            {t("action.pick")}
            <ChevronDown />
          </Button>
          <Button size="lg" tabIndex={-1} className={cn("max-md:hidden", SHADE)}>
            {t("action.draw")}
          </Button>
        </div>
      </div>
      <Skeleton className="fixed inset-x-4 bottom-20 z-30 h-11 md:hidden" />
    </div>
  );
}

// Management (D25): the title; the sub-tab pills with New action and Clear on their right; the
// warnings table's header and rows (two lines of when and by whom).
function ModerationBody({ t }: Ctx) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <Shade className="font-serif text-title">{t("tab.moderation")}</Shade>
        <div className="flex flex-wrap items-center gap-3">
          <Pills items={(["warn", "punish", "ban"] as const).map((k) => [t(`mod.sub.${k}`), "0"])} />
          <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0 max-md:w-full">
            <Button size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
              <Plus />
              {t("mod.new")}
            </Button>
            <Button variant="destructive" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
              <Trash2 />
              {t("mod.clear")}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className={cn("grid items-center gap-x-3 border border-transparent px-4 text-caption uppercase max-md:hidden", MOD_COLS.warn)}>
          <span>&nbsp;</span>
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={cn(MOD_ROW, MOD_COLS.warn)}>
            <Shade className="text-name">brkdmr_tv</Shade>
            <Shade className="w-full text-meta max-md:hidden">&nbsp;</Shade>
            <Shade className="text-meta max-md:hidden">100</Shade>
            <span className="flex min-w-0 flex-col text-meta max-md:hidden">
              <Shade className="w-full">&nbsp;</Shade>
              <Shade className="w-full">&nbsp;</Shade>
            </span>
            <Skeleton className="size-8 max-md:size-11" />
          </div>
        ))}
      </div>
    </div>
  );
}

// The title with its filter and Clear history; a card per day: its heading, then time, icon and
// sentence lines.
function HistoryBody({ t, today }: Ctx) {
  // The median line is 37 characters (two lines on a phone, one from 768px): a sample that long.
  const line = t("act.add_player", { actor: "atlasatakahraman", target: "brkdmr_tv_01" });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Shade className="font-serif text-title">{t("tab.history")}</Shade>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          <Pills items={(["filter.all", "tab.queue", "tab.teams", "tab.moderation", "history.chat"] as const).map((k) => [t(k), "00"])} />
          <Button variant="destructive" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
            <Trash2 />
            {t("history.clear")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {[6, 3].map((n, d) => (
          <section key={d} className={DAY}>
            <div className={DAY_HEAD}>
              <Shade>{today}</Shade>
            </div>
            <ol>
              {Array.from({ length: n }, (_, i) => (
                <li key={i} className={LINE}>
                  <Shade className="text-meta tabular-nums">00:00</Shade>
                  <Skeleton className="size-4 translate-y-0.5 self-start" />
                  <Shade wrap>{line}</Shade>
                  <span />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

// Games: the title, its view pills, search and Clear games, then one-line game rows.
function GamesBody({ t }: Ctx) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Shade className="font-serif text-title">{t("tab.games")}</Shade>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          <Pills items={[[t("games.view.games")], [t("games.view.stats")]]} />
          <div className="relative max-md:w-full">
            <Skeleton className={GAMES_SEARCH} />
          </div>
          <Button variant="destructive" size="lg" tabIndex={-1} className={cn("max-md:h-11", SHADE)}>
            <Trash2 />
            {t("games.clear")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className={cn(GAME_ROW, "w-full rounded-xl")} />
        ))}
      </div>
    </div>
  );
}

// Sections: title and hint on the left, the card of fields on the right.
function SettingsBody({ t }: Ctx) {
  const sections = [
    ["settings.queue", 3],
    ["settings.riot", 2],
    ["settings.draws", 4],
  ] as const;
  return (
    <div className="flex flex-col">
      {sections.map(([title, n]) => (
        <div key={title} className={SECTION}>
          <div className="flex flex-col gap-1">
            <Shade className="font-serif text-team">{t(title)}</Shade>
          </div>
          <div className={SECTION_CARD}>
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Shade className="text-sm">&nbsp;</Shade>
                <Skeleton className="h-9 w-full max-md:h-11" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const BODIES: Record<Tab, (ctx: Ctx) => React.ReactNode> = {
  queue: QueueBody,
  teams: TeamsBody,
  moderation: ModerationBody,
  history: HistoryBody,
  games: GamesBody,
  settings: SettingsBody,
};
