"use client";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { PlayerRow, RankText, Tag } from "@/components/queue/player-row";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Typewriter } from "@/components/typewriter";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMedia } from "@/components/use-client-state";
import { isError } from "@/lib/queue-store";
import { averageRank } from "@/lib/rank";
import { cn } from "@/lib/utils";
import type { ChangeEvent, Draw, DrawEntry, Player } from "@/types/queue";

// The draw reveal's cadence (DESIGN.md § The draw reveal): one name every 160ms, each typed at
// 30ms a character and sharpening over 200ms. Off the motion ladder on purpose: it is a sequence.
export const REVEAL = { step: 160, speed: 30, sharpen: 200 };

// Draw, reroll and pick, shared by the Teams tab, the command palette and the global keys.
export function useDrawActions() {
  const act = useAct();
  const store = useStore();
  const { t } = useT();
  const base = () => store.get().draw?.id ?? null;
  const stale = (r: Awaited<ReturnType<typeof act>>) => {
    if (!isError(r) && (r as ChangeEvent).kind === "draw_stale") toast(t("draw.stale"));
  };
  return {
    draw: () => act("draw_teams", { p_base: base(), p_reroll: false }, { done: "done.draw" }).then(stale),
    reroll: () => act("draw_teams", { p_base: base(), p_reroll: true }, { done: "done.reroll" }).then(stale),
    pick: (n: number) =>
      act("pick_from_waiting", { p_n: n, p_base: base() }, { done: "done.pick", vars: { n } }).then(stale),
  };
}

// Whether a draw animates on this device: the streamer's setting, then reduced motion.
export function useRevealMotion(): boolean {
  const setting = useQueue((v) => v.settings.draw_reveal);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  return setting === "typewriter" && !reduced;
}

type Landing = { entry: DrawEntry; team: 0 | 1; at: number };

// Team 1, team 2, alternately. Each list already starts with its protected players, so they
// land first, "because they were never in doubt".
export function revealOrder(lists: DrawEntry[][]): Landing[] {
  const out: Landing[] = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    lists.forEach((l, team) => {
      if (l[i]) out.push({ entry: l[i], team: team as 0 | 1, at: out.length * REVEAL.step });
    });
  }
  return out;
}

export function revealDuration(order: Landing[]): number {
  return Math.max(0, ...order.map((o) => o.at + [...o.entry.kick_username].length * REVEAL.speed + REVEAL.sharpen));
}

// One name landing: typed in with Typewriter, its 🛡 rising with it.
export function LandingName({ entry, at }: { entry: DrawEntry; at: number }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-row-edge bg-background px-4 py-3">
      <Typewriter text={entry.kick_username} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={at} className="text-name" />
      {entry.locked && (
        <span className="animate-enter" style={{ animationDelay: `${at}ms` }}>
          <Tag tone="brand">🛡 {t("tag.protected")}</Tag>
        </span>
      )}
    </div>
  );
}

function TeamCard({ team, count, size, avg, children }: {
  team: 1 | 2;
  count: number;
  size: number;
  avg?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card">
      <div className={cn("h-[5px]", team === 1 ? "bg-team-1" : "bg-team-2")} aria-hidden />
      <div className="flex flex-col gap-3 p-4">
        <header className="flex items-baseline justify-between gap-3">
          <h3
            className={cn(
              "min-w-0 truncate font-serif text-team",
              team === 1
                ? "text-team-1 selection:bg-team-1 selection:text-background"
                : "text-team-2 selection:bg-team-2 selection:text-background",
            )}
          >
            {t(`team.${team}`)}
          </h3>
          <span className="flex shrink-0 items-baseline gap-3 text-meta text-muted-foreground">
            {avg}
            <span className="tabular-nums">{t("teams.count", { n: count, size })}</span>
          </span>
        </header>
        <div data-rows className="flex flex-col gap-1.5">
          {children}
        </div>
      </div>
    </section>
  );
}

function Avg({ players }: { players: Player[] }) {
  const { t } = useT();
  const avg = averageRank(players);
  if (!avg) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {t("teams.avg")}
      <RankText player={{ rank: { tier: avg.tier, division: avg.division, lp: null, icon: null } } as Player} />
    </span>
  );
}

// The rosters while a fresh draw lands, read from the saved result; the average rank appears
// once the last name has landed, when the live rosters take over.
function RevealRosters({ draw, size }: { draw: Draw; size: number }) {
  const store = useStore();
  const order = useMemo(() => revealOrder(draw.result.teams ?? [[], []]), [draw]);
  useEffect(() => {
    const id = setTimeout(() => store.clearReveal(), revealDuration(order) + 300);
    return () => clearTimeout(id);
  }, [order, store]);
  return (
    <>
      {([0, 1] as const).map((team) => (
        <TeamCard key={team} team={(team + 1) as 1 | 2} count={draw.result.teams?.[team].length ?? 0} size={size}>
          {order
            .filter((o) => o.team === team)
            .map((o) => (
              <LandingName key={o.entry.id} entry={o.entry} at={o.at} />
            ))}
        </TeamCard>
      ))}
    </>
  );
}

export function TeamsTab() {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const act = useAct();
  const players = useQueue((v) => v.players);
  const size = useQueue((v) => v.settings.team_size);
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const draw = useQueue((v) => v.draw);
  const reveal = useQueue((v) => v.reveal);
  const motion = useRevealMotion();
  const { draw: drawTeams, reroll, pick } = useDrawActions();
  const waiting = useQueue((v) => v.players.filter((p) => p.status === "waiting").length);

  const rosters = useMemo(
    () => ([1, 2] as const).map((n) => players.filter((p) => p.status === "playing" && p.team === n)),
    [players],
  );
  const revealing = motion && reveal?.kind === "teams" ? reveal : null;
  const e3 = enter(ui.entering, 3);
  const e4 = enter(ui.entering, 4);

  return (
    <div className="flex flex-col gap-6">
      <h2
        style={e3.style}
        className={cn("flex flex-wrap items-baseline gap-x-3 font-serif text-headline max-md:text-title", e3.className)}
      >
        <span className="text-team-1 selection:bg-team-1 selection:text-background">{t("team.1")}</span>
        <span className="text-title text-muted-foreground italic max-md:text-body">{t("match.vs")}</span>
        <span className="text-team-2 selection:bg-team-2 selection:text-background">{t("team.2")}</span>
      </h2>

      <div style={e4.style} className={cn("grid grid-cols-2 items-start gap-4 max-md:grid-cols-1", e4.className)}>
        {revealing ? (
          <RevealRosters key={revealing.id} draw={revealing} size={size} />
        ) : (
          rosters.map((roster, i) => (
            <TeamCard key={i} team={(i + 1) as 1 | 2} count={roster.length} size={size} avg={<Avg players={roster} />}>
              {roster.length === 0 ? (
                <p className="rounded-xl border border-dashed border-row-edge px-4 py-3 text-meta text-muted-foreground">
                  {t("teams.empty")}
                </p>
              ) : (
                roster.map((p) => <PlayerRow key={p.id} player={p} inset />)
              )}
            </TeamCard>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-card p-4 max-md:flex-col max-md:items-stretch">
        <div className="flex items-start gap-3">
          <Switch
            id="fair-play"
            checked={fairPlay}
            disabled={!canWrite}
            // No toast: set_fair_play stores no inverse, and the switch itself shows the state.
            onCheckedChange={(on) => act("set_fair_play", { p_on: on })}
            className="mt-0.5"
          />
          {/* The whole text is the switch's label, so the touch target is the block, not 18px. */}
          <Label htmlFor="fair-play" className="flex min-h-11 cursor-pointer flex-col items-start gap-0.5 leading-normal">
            <span className="text-control">{t("teams.fair_play")}</span>
            <span className="text-meta font-normal text-muted-foreground">{t("teams.fair_play.hint")}</span>
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2">
          <Button
            variant="outline"
            size="lg"
            className="max-md:h-11"
            disabled={!canWrite || draw?.kind !== "teams"}
            onClick={() => void reroll()}
          >
            {t("action.reroll")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite || waiting === 0}>
                {t("action.pick")}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 p-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <DropdownMenuItem key={n} onSelect={() => void pick(n)}>
                  {t("action.pick.n", { n })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="lg" className="max-md:hidden" disabled={!canWrite} onClick={() => void drawTeams()}>
            {t("action.draw")}
          </Button>
        </div>
      </div>
      {/* Under 768px the view's primary sticks above the tab bar (DESIGN.md § Mobile). */}
      <Button
        size="lg"
        className="fixed inset-x-4 bottom-20 z-30 h-11 shadow-lg md:hidden"
        disabled={!canWrite}
        onClick={() => void drawTeams()}
      >
        {t("action.draw")}
      </Button>
    </div>
  );
}
