"use client";
import { ChevronDown, ShieldCheck, Shuffle, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { draggedPlayer, PlayerRow, RankText, Tag, useMoveTo, useRiot } from "@/components/queue/player-row";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Typewriter } from "@/components/typewriter";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useMedia, useStored } from "@/components/use-client-state";
import { isError, type QueueView } from "@/lib/queue-store";
import { averageRank } from "@/lib/rank";
import { cn } from "@/lib/utils";
import type { ChangeEvent, Draw, DrawEntry, Player } from "@/types/queue";

// The draw reveal's cadence (DESIGN.md § The draw reveal): one name every 160ms, each typed at
// 30ms a character and sharpening over 200ms. Off the motion ladder on purpose: it is a sequence.
export const REVEAL = { step: 160, speed: 30, sharpen: 200 };

// Draw, reroll, shuffle, pick and the clears, shared by the toolbar, the Teams tab, the page
// menu, the command palette and the global keys.
export type PickSource = "waiting" | "teams" | "all";

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
    shuffle: () => act("shuffle_teams", { p_base: base() }, { done: "done.shuffle_teams" }).then(stale),
    pick: (n: number, source: PickSource = "waiting") =>
      act("pick_players", { p_n: n, p_source: source, p_base: base() }, { done: `done.pick.${source}`, vars: { n } }).then(stale),
    clearTeams: () => act("clear_teams", {}, { done: "done.clear_teams" }),
    clearQueue: () => {
      const ids = store.get().players.map((p) => p.id);
      return act("remove_players", { p_ids: null }, { optimistic: { ids, patch: () => null }, done: "done.clear_queue" });
    },
    clearModeration: () => act("clear_moderation", {}, { done: "done.clear_moderation" }),
  };
}

const PICK_SOURCES = ["waiting", "teams", "all"] as const;
const PICK_SIZES = [1, 2, 3];

// Pick's source (per browser, one for every pick control) and the ×n it can fill. The pool counts
// as pick_players does: the source's statuses, less anyone under a live ban or punishment. A ×n
// larger than the pool is hidden (owner, 2026-09-27); ×1 stays, disabled, when the pool is empty.
export function usePick() {
  const [source, setSource] = useStored<PickSource>("queue.pick-source", "waiting", PICK_SOURCES);
  const pool = useQueue((v) => pickPool(v, source));
  return { source, setSource, sources: PICK_SOURCES, pool, sizes: PICK_SIZES.filter((n) => n === 1 || n <= pool) };
}

function pickPool({ players, moderation }: QueueView, source: PickSource) {
  const now = Date.now();
  const barred = moderation.filter(
    (m) =>
      m.kind !== "warn" &&
      !m.revoked_at &&
      (!m.expires_at || Date.parse(m.expires_at) > now) &&
      (m.games_left === null || m.games_left > 0),
  );
  return players.filter(
    (p) =>
      (source === "waiting" ? p.status === "waiting" : source === "teams" ? p.status === "playing" : p.status !== "away") &&
      !barred.some(
        (m) =>
          m.kick_username.toLowerCase() === p.kick_username.toLowerCase() ||
          (m.kick_user_id !== null && m.kick_user_id === p.kick_user_id),
      ),
  ).length;
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

// Every roster slot is one row high, filled or not: a team card holds team-size slots (August's
// fixed team boxes), so the cards keep their height while names land and leave.
const SLOT = "min-h-[3.875rem]";

function EmptySlots({ from, size, onAdd }: { from: number; size: number; onAdd?: (at: HTMLElement) => void }) {
  const { t } = useT();
  const cls = cn(
    "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 rounded-xl border border-dashed border-row-edge px-4 py-3 text-left",
    SLOT,
  );
  return Array.from({ length: Math.max(size - from, 0) }, (_, i) => {
    const body = (
      <>
        <span className="font-serif text-numeral text-muted-foreground/50 tabular-nums select-none">{from + i + 1}</span>
        <span className="inline-flex items-center gap-2 text-meta text-muted-foreground">
          {onAdd && <UserPlus className="size-4" aria-hidden />}
          {t("teams.slot.empty")}
        </span>
      </>
    );
    return onAdd ? (
      <button
        key={i}
        type="button"
        data-slot-add
        data-add-target
        onClick={(e) => onAdd(e.currentTarget)}
        className={cn(cls, "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40")}
      >
        {body}
      </button>
    ) : (
      <div key={i} className={cls}>
        {body}
      </div>
    );
  });
}

// A team card's Add (owner, 2026-09-23): a waiting player straight into this team, or a new one
// through Add player, which then moves them here. It opens on what was clicked: the header's
// button, or the empty slot itself (owner, 2026-09-27).
function AddToTeam({ team, at, onClose }: { team: 1 | 2; at: HTMLElement | null; onClose: () => void }) {
  const { t } = useT();
  const ui = useUi();
  const moveTo = useMoveTo();
  const riot = useRiot();
  // Select the stable array and filter outside: a selector that builds a new array makes
  // useSyncExternalStore see a new snapshot every render and loop.
  const players = useQueue((v) => v.players);
  const waiting = useMemo(() => players.filter((p) => p.status === "waiting"), [players]);
  const pick = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <Popover open={!!at} onOpenChange={(o) => !o && onClose()}>
      {at && <PopoverAnchor virtualRef={{ current: at }} />}
      <PopoverContent
        align={at?.dataset.slotAdd === undefined ? "end" : "start"}
        className="w-72 p-0"
        // Pressing another of this card's add targets must not close first and reopen in a race
        // (owner, 2026-09-27: the list jumped, or stayed shut): the card opens it there instead.
        onInteractOutside={(e) => {
          const hit = (e.target as Element | null)?.closest?.("[data-add-target]");
          if (hit && hit.closest("section") === at?.closest("section")) e.preventDefault();
        }}
      >
        <Command>
          <CommandInput placeholder={t("teams.add.search")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("teams.add.none")}</CommandEmpty>
            {waiting.length > 0 && (
              <CommandGroup heading={t("teams.add.waiting")}>
                {waiting.map((p) => (
                  <CommandItem key={p.id} value={`${p.kick_username} ${p.riot_id ?? ""}`} onSelect={pick(() => void moveTo(p, team))}>
                    {/* Kick names run to 25 characters: both halves truncate rather than overflow. */}
                    <span className="truncate text-name">{p.kick_username}</span>
                    {riot && p.riot_id && <span className="min-w-0 truncate font-mono text-code text-muted-foreground">{p.riot_id}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__new"
                onSelect={pick(() => {
                  ui.setAddTo(team);
                  ui.setAdding(true);
                })}
              >
                <UserPlus aria-hidden />
                {t("teams.add.new")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// One name landing: typed in with Typewriter, its protected tag rising with it.
export function LandingName({ entry, at }: { entry: DrawEntry; at: number }) {
  const { t } = useT();
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-row-edge bg-background px-4 py-3", SLOT)}>
      <Typewriter text={entry.kick_username} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={at} className="text-name" />
      {entry.locked && (
        <span className="animate-enter" style={{ animationDelay: `${at}ms` }}>
          <Tag tone="brand" icon={ShieldCheck}>{t("tag.protected")}</Tag>
        </span>
      )}
    </div>
  );
}

function TeamCard({ team, count, size, avg, addable = false, children }: {
  team: 1 | 2;
  count: number;
  size: number;
  avg?: React.ReactNode;
  addable?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const moveTo = useMoveTo();
  const canWrite = useCanWrite();
  const [over, setOver] = useState(false);
  // Each opening is its own list (a new key), so a second target opens a fresh list there
  // instead of sliding the open one across; the same target again closes it.
  const [add, setAdd] = useState<{ at: HTMLElement; n: number } | null>(null);
  const openAt = (at: HTMLElement) => setAdd((a) => (a?.at === at ? null : { at, n: (a?.n ?? 0) + 1 }));
  const canAdd = addable && canWrite && count < size;
  // Drop target for a player of the other team, or anyone dragged here (August's team boxes).
  const takes = (d: ReturnType<typeof draggedPlayer>) => !!d && !(d.status === "playing" && d.team === team);
  const card = (
    <section
      onDragOver={(e) => {
        if (!takes(draggedPlayer())) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        const d = draggedPlayer();
        setOver(false);
        if (!d || !takes(d)) return;
        e.preventDefault();
        void moveTo(d, team);
      }}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl bg-card",
        over && (team === 1 ? "ring-2 ring-team-1/60" : "ring-2 ring-team-2/60"),
      )}
    >
      <div className={cn("h-[5px]", team === 1 ? "bg-team-1" : "bg-team-2")} aria-hidden />
      <div className="flex flex-col gap-3 p-4">
        {/* No team name here: the match headline above names both teams (owner, 2026-09-23). */}
        <AddToTeam key={add?.n ?? 0} team={team} at={add?.at ?? null} onClose={() => setAdd(null)} />
        <header aria-label={t(`team.${team}`)} className="flex min-h-9 items-center justify-between gap-3 text-meta text-muted-foreground">
          <span className="flex min-w-0 items-baseline gap-3">
            <span className="tabular-nums">{t("teams.count", { n: count, size })}</span>
            {avg}
          </span>
          {addable && (
            <Button
              variant="ghost"
              size="lg"
              className={cn("max-md:h-11", team === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2")}
              disabled={!canAdd}
              data-add-target
              onClick={(e) => openAt(e.currentTarget)}
            >
              <UserPlus aria-hidden />
              {t("teams.add", { team: t(`team.${team}`) })}
            </Button>
          )}
        </header>
        <div data-rows className="flex flex-col gap-1.5">
          {children}
          <EmptySlots from={count} size={size} onAdd={canAdd ? openAt : undefined} />
        </div>
      </div>
    </section>
  );
  if (!addable) return card;
  // Right-click on the card (not on a player, whose row has its own menu): this team's menu.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <TeamMenu team={team} count={count} size={size} canAdd={canAdd} />
    </ContextMenu>
  );
}

function TeamMenu({ team, count, size, canAdd }: { team: 1 | 2; count: number; size: number; canAdd: boolean }) {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const moveTo = useMoveTo();
  const players = useQueue((v) => v.players);
  const waiting = useMemo(() => players.filter((p) => p.status === "waiting"), [players]);
  const playing = players.length - waiting.length - players.filter((p) => p.status === "away").length;
  const { shuffle, clearTeams } = useDrawActions();
  const riot = useRiot();
  return (
    <ContextMenuContent className="min-w-60 p-1.5">
      <ContextMenuLabel className={cn("font-normal", team === 1 ? "text-team-1" : "text-team-2")}>
        {t(`team.${team}`)} · {t("teams.count", { n: count, size })}
      </ContextMenuLabel>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!canAdd}>
          <UserPlus aria-hidden />
          {t("teams.add.waiting")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 min-w-52 overflow-y-auto p-1.5">
          {waiting.length === 0 ? (
            <ContextMenuItem disabled>{t("teams.add.none")}</ContextMenuItem>
          ) : (
            waiting.map((p) => (
              <ContextMenuItem key={p.id} onSelect={() => void moveTo(p, team)}>
                <span className="truncate">{p.kick_username}</span>
                {riot && p.riot_id && <span className="ml-auto truncate pl-3 font-mono text-code text-muted-foreground">{p.riot_id}</span>}
              </ContextMenuItem>
            ))
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem
        disabled={!canAdd}
        onSelect={() => {
          ui.setAddTo(team);
          ui.setAdding(true);
        }}
      >
        <UserPlus aria-hidden />
        {t("teams.add.new")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canWrite || playing < 2} onSelect={() => void shuffle()}>
        <Shuffle aria-hidden />
        {t("action.shuffle_teams")}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" disabled={!canWrite || playing === 0} onSelect={() => void clearTeams()}>
        <UsersRound aria-hidden />
        {t("action.clear_teams")}
      </ContextMenuItem>
    </ContextMenuContent>
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

// A fresh draw lands in the live rosters themselves: each drawn row rises into its slot and types
// the name it keeps showing, so nothing is swapped when the reveal ends (owner, 2026-09-27: the
// avatars used to jump in after the names). Rows land in roster order, alternating teams.
function useLanding(draw: Draw | null, rosters: Player[][]) {
  return useMemo(() => {
    if (!draw) return null;
    const ids = new Set((draw.result.teams ?? []).flat().map((e) => e.id));
    const lists = rosters.map((r) =>
      r.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, kick_username: p.riot_id?.split("#")[0] ?? p.kick_username, locked: p.locked })),
    );
    const order = revealOrder(lists);
    return { at: new Map(order.map((o) => [o.entry.id, o.at])), duration: revealDuration(order) };
  }, [draw, rosters]);
}

// Ends the reveal once the last name has landed; the average rank then appears.
function RevealEnd({ duration }: { duration: number }) {
  const store = useStore();
  useEffect(() => {
    const id = setTimeout(() => store.clearReveal(), duration + 300);
    return () => clearTimeout(id);
  }, [duration, store]);
  return null;
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
  const { draw: drawTeams, reroll, shuffle, clearTeams, pick } = useDrawActions();
  const picking = usePick();
  const playing = useQueue((v) => v.players.filter((p) => p.status === "playing").length);

  const rosters = useMemo(
    () => ([1, 2] as const).map((n) => players.filter((p) => p.status === "playing" && p.team === n)),
    [players],
  );
  const revealing = motion && reveal?.kind === "teams" ? reveal : null;
  const landing = useLanding(revealing, rosters);
  const e3 = enter(ui.entering, 3);
  const e4 = enter(ui.entering, 4);
  const riot = useRiot();

  return (
    <div className="flex flex-col gap-6">
      {/* Team 1 over its card on the left, vs in the middle, team 2 on the right (owner, 2026-09-23). */}
      <h2
        style={e3.style}
        className={cn("grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-4 font-serif text-headline max-md:text-title", e3.className)}
      >
        <span className="truncate text-team-1 selection:bg-team-1 selection:text-background">{t("team.1")}</span>
        <span className="text-title text-muted-foreground italic max-md:text-body">{t("match.vs")}</span>
        <span className="truncate text-right text-team-2 selection:bg-team-2 selection:text-background">{t("team.2")}</span>
      </h2>

      <div style={e4.style} className={cn("grid grid-cols-2 items-stretch gap-4 max-lg:grid-cols-1", e4.className)}>
        {landing && <RevealEnd key={revealing!.id} duration={landing.duration} />}
        {rosters.map((roster, i) => (
          <TeamCard key={i} team={(i + 1) as 1 | 2} count={roster.length} size={size} avg={!landing && riot && <Avg players={roster} />} addable={!landing}>
            {roster.map((p, n) => {
              const at = landing?.at.get(p.id);
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  number={n + 1}
                  variant="roster"
                  landAt={at}
                  enterStyle={at === undefined ? undefined : { className: "animate-enter", style: { animationDelay: `${at}ms` } }}
                />
              );
            })}
          </TeamCard>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-card p-4 max-md:flex-col max-md:items-stretch">
        {/* One line, centred on the buttons beside it; the effect needs no sentence (owner,
            2026-09-27). The label is the touch target, not the 18px switch. */}
        <div className="flex items-center gap-3">
          <Switch
            id="fair-play"
            checked={fairPlay}
            disabled={!canWrite}
            // No toast: set_fair_play stores no inverse, and the switch itself shows the state.
            onCheckedChange={(on) => act("set_fair_play", { p_on: on })}
          />
          <Label htmlFor="fair-play" className="flex min-h-11 cursor-pointer items-center text-control">
            {t("teams.fair_play")}
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2">
          <Button variant="ghost" size="lg" className="text-destructive hover:text-destructive max-md:h-11" disabled={!canWrite || playing === 0} onClick={() => void clearTeams()}>
            {t("action.clear_teams")}
          </Button>
          <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite || playing < 2} onClick={() => void shuffle()}>
            {t("action.shuffle_teams")}
          </Button>
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
              <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite || picking.pool === 0}>
                {t("action.pick")}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 p-1.5">
              {picking.sizes.map((n) => (
                <DropdownMenuItem key={n} onSelect={() => void pick(n, picking.source)}>
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
