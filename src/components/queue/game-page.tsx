"use client";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Ellipsis, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { copyResult, gameSize, WinLoss } from "@/components/queue/games-tab";
import { GP_CARD_HEAD, GP_GRID, GP_HEAD, GP_META, GP_ROW, GP_TITLE } from "@/components/queue/geometry";
import { CardTrigger } from "@/components/queue/player-card";
import { RankText, useRanks, useRiotIds } from "@/components/queue/player-row";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNow } from "@/components/use-now";
import { isError } from "@/lib/queue-store";
import { span } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Game, GameView, Player, PlayerRecord } from "@/types/queue";

// A game's page (DESIGN.md § A game's page, owner 2026-09-28): so a row stays one line and a
// result can be linked. The headline, when and how long, then both rosters as they stood, the
// winner's first.
export function GamePage({ view }: { view: GameView }) {
  const { t, lang } = useT();
  const router = useRouter();
  const act = useAct();
  const canWrite = useCanWrite();
  const now = useNow();
  const slug = useQueue((v) => v.channel.slug);
  const back = `/c/${slug}?tab=games`;
  const { game, prev, next } = view;

  // ← and → step to the previous and next game, as the buttons do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as Element | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest?.("input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]")) return;
      const to = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : null;
      if (to !== null) router.push(`/c/${slug}/games/${to}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router, slug]);

  const games = (
    <Button variant="ghost" size="lg" className="-ml-3 max-md:h-11" asChild>
      <Link href={back} aria-label={t("game.back")}>
        <ArrowLeft aria-hidden />
        {t("tab.games")}
      </Link>
    </Button>
  );

  // Removed, or never this channel's: a 404 in the page's own words.
  if (!game)
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        {games}
        <h1 className={GP_TITLE}>{t("game.missing.title", { n: view.n })}</h1>
        <p className="text-muted-foreground">{t("game.missing.body")}</p>
      </div>
    );

  const ended = new Date(game.ended_at);
  // The viewer's own clock, so it waits for it (useNow is 0 on the server).
  const when = now
    ? new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(ended)
    : null;
  const length = game.started_at ? span(Math.max(60_000, ended.getTime() - Date.parse(game.started_at)), t) : null;
  // The winner in its colour and "game 5" in gold Newsreader, as the counts (owner, 2026-09-28).
  const title = t("game.title")
    .split(/(\{team\}|\{game\})/)
    .map((part, i) =>
      part === "{team}" ? (
        <span key={i} className={game.winner === 1 ? "text-team-1" : "text-team-2"}>
          {t(`team.${game.winner}`)}
        </span>
      ) : part === "{game}" ? (
        <span key={i} className="text-brand tabular-nums">
          {t("game.title.game", { n: game.n })}
        </span>
      ) : (
        part
      ),
    );
  const step = (to: number | null, label: string, Icon: typeof ChevronLeft) => (
    <Tip label={label}>
      {to === null ? (
        <Button variant="ghost" size="icon-lg" disabled aria-label={label}>
          <Icon aria-hidden />
        </Button>
      ) : (
        <Button variant="ghost" size="icon-lg" asChild>
          <Link href={`/c/${slug}/games/${to}`} aria-label={label}>
            <Icon aria-hidden />
          </Link>
        </Button>
      )}
    </Tip>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className={GP_HEAD}>
        {games}
        <div className="flex items-center gap-1">
          {step(prev, t("game.prev"), ChevronLeft)}
          {step(next, t("game.next"), ChevronRight)}
          <Button variant="outline" size="lg" className="ml-2 max-md:h-11" onClick={() => copyResult(game, t)}>
            <Copy aria-hidden />
            {t("games.copy")}
          </Button>
          <DropdownMenu>
            <Tip label={t("games.menu", { n: game.n })}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" aria-label={t("games.menu", { n: game.n })}>
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="min-w-52 p-1.5">
              {/* Undoable from the toast; the page it leaves is Games. */}
              <DropdownMenuItem
                variant="destructive"
                disabled={!canWrite}
                onSelect={async () => {
                  const r = await act("remove_game", { p_game: game.id }, { done: "done.remove_game", vars: { n: game.n } });
                  if (!isError(r)) router.push(back);
                }}
              >
                <Trash2 aria-hidden />
                {t("games.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className={GP_TITLE}>
          {title}
        </h1>
        {/* Set apart by space, no dot separators (DESIGN.md). */}
        <p className={GP_META}>
          <time dateTime={game.ended_at}>{when}</time>
          {length && <span>{length}</span>}
          <span>{gameSize(game, t)}</span>
        </p>
      </div>

      <div className={GP_GRID}>
        {([game.winner, game.winner === 1 ? 2 : 1] as const).map((team) => (
          <GameCard key={team} game={game} team={team} records={view.records} />
        ))}
      </div>
    </div>
  );
}

// A roster as it stood: number, name (the player card when they are in the queue now), the rank
// at the time of the game and the name's channel W / L.
function GameCard({ game, team, records }: { game: Game; team: 1 | 2; records: PlayerRecord[] }) {
  const { t } = useT();
  const riot = useRiotIds();
  const ranks = useRanks();
  const players = useQueue((v) => v.players);
  const tone = team === 1 ? "text-team-1" : "text-team-2";
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card">
      <div className={cn("h-[5px]", team === 1 ? "bg-team-1" : "bg-team-2")} aria-hidden />
      <div className="flex flex-col gap-3 p-4">
        <h2 className={cn(GP_CARD_HEAD, tone)}>
          {t(`team.${team}`)}
          {game.winner === team && (
            <>
              <Trophy aria-hidden className="size-5 text-brand" />
              <span className="sr-only">{t("game.winner")}</span>
            </>
          )}
        </h2>
        <ol className="flex flex-col gap-1.5">
          {game.teams[team - 1].map((e, i) => {
            const row = GP_ROW;
            const number = <span className="font-serif text-numeral text-muted-foreground tabular-nums select-none">{i + 1}</span>;
            if (e.removed)
              return (
                <li key={`removed-${i}`} className={row}>
                  {number}
                  <span className="text-muted-foreground italic">{t("game.removed_player")}</span>
                </li>
              );
            const name = e.kick_username.toLowerCase();
            const record = records.find((r) => r.name === name);
            const now = players.find((p) => p.kick_username.toLowerCase() === name);
            const label = (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-name">{e.kick_username}</span>
                {riot && e.riot_id && <span className="min-w-0 truncate font-mono text-code text-muted-foreground">{e.riot_id}</span>}
              </span>
            );
            return (
              <li key={e.id} className={row}>
                {number}
                {now ? (
                  <CardTrigger player={now} seen={now} keyboard={false}>
                    {label}
                  </CardTrigger>
                ) : (
                  label
                )}
                <span className="flex items-center gap-4 text-meta whitespace-nowrap text-muted-foreground tabular-nums">
                  {ranks && <RankText player={{ rank: e.rank } as Player} />}
                  {record && (
                    <span>
                      <WinLoss text={t("game.record")} w={record.wins} l={record.losses} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
