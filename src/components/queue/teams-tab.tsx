"use client";
import { ChevronDown, ShieldCheck, Shuffle, Trophy, UserPlus, UsersRound } from "lucide-react";
import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { confirm } from "@/components/queue/confirm";
import { draggedPlayer, PlayerRow, Tag, TeamAddContext, useMoveTo, useRanks, useRiotIds } from "@/components/queue/player-row";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Typed, useMotion } from "@/components/prefs";
import { Tip } from "@/components/tip";
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
import { useStored } from "@/components/use-client-state";
import { isError, type QueueView } from "@/lib/queue-store";
import { cn } from "@/lib/utils";
import type { ChangeEvent, DrawEntry, Player } from "@/types/queue";
import { REVEAL, revealOrder, shieldsOf } from "@/components/queue/reveal-order";
import { Avg, EMPTY_SLOT, EmptySlotBody, shieldFor, slotLayout, TeamCardView, TeamCount, useLanding } from "@/components/queue/team-card";
import { PICK_SIZES, SLOT, TEAMS_BAR, TEAMS_BAR_BUTTONS, TEAMS_GRID } from "@/components/queue/geometry";

export { REVEAL };

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
      // A pick moves nobody; the only thing Undo gives back is a protection it used (owner,
      // 2026-09-27), and those players are the only rows it changes.
      act("pick_players", { p_n: n, p_source: source, p_base: base() }, {
        done: `done.pick.${source}`,
        vars: { n },
        undoable: (r) => r.rows.some((row) => row._t === "players"),
      }).then(stale),
    // The clears ask first (owner, 2026-09-27), wherever they are pressed from.
    clearTeams: async () => {
      const n = store.get().players.filter((p) => p.status === "playing").length;
      const ask = { title: t("confirm.clear_teams.title"), body: t("confirm.clear_teams.body", { n }), action: t("action.clear_teams") };
      if (await confirm(ask)) return act("clear_teams", {}, { done: "done.clear_teams" });
    },
    clearQueue: async () => {
      const ids = store.get().players.map((p) => p.id);
      const ask = { title: t("confirm.clear_queue.title"), body: t("confirm.clear_queue.body", { n: ids.length }), action: t("action.clear_queue") };
      if (await confirm(ask)) return act("remove_players", { p_ids: null }, { optimistic: { ids, patch: () => null }, done: "done.clear_queue" });
    },
    clearModeration: async () => {
      const ask = { title: t("confirm.clear_moderation.title"), body: t("confirm.clear_moderation.body"), action: t("mod.clear") };
      if (await confirm(ask)) return act("clear_moderation", {}, { done: "done.clear_moderation" });
    },
    // No Undo: the feed is the undo stack (0022).
    clearHistory: async () => {
      const ask = { title: t("confirm.clear_history.title"), body: t("confirm.clear_history.body"), action: t("history.clear") };
      if (await confirm(ask)) return act("clear_history", {}, { done: "done.clear_history", undoable: () => false });
    },
  };
}

const PICK_SOURCES = ["waiting", "teams", "all"] as const;

// Pick's source (per browser, one for every pick control) and the ×n it can fill. The pool counts
// as pick_players does: the source's statuses, less anyone under a live ban or punishment. A ×n
// larger than the pool is hidden (owner, 2026-09-27); ×1 stays, disabled, when the pool is empty.
export function usePick() {
  const [source, setSource] = useStored<PickSource>("queue.pick-source", "waiting", PICK_SOURCES);
  const pool = useQueue((v) => pickPool(v, source).length);
  return { source, setSource, sources: PICK_SOURCES, pool, sizes: PICK_SIZES.filter((n) => n === 1 || n <= pool) };
}

export function pickPool({ players, moderation }: QueueView, source: PickSource): Player[] {
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
      (source === "waiting" ? p.status === "waiting" : source === "teams" ? p.status === "playing" : p.status === "waiting" || p.status === "playing") &&
      !barred.some(
        (m) =>
          m.kick_username.toLowerCase() === p.kick_username.toLowerCase() ||
          (m.kick_user_id !== null && m.kick_user_id === p.kick_user_id),
      ),
  );
}

// Whether a draw animates on this device: the streamer's setting, then this browser's
// Animations (off under reduced motion too). A team draw lands by Typewriter whichever reveal
// a pick uses (D22).
export function useRevealMotion(): boolean {
  const setting = useQueue((v) => v.settings.draw_reveal);
  const motion = useMotion();
  return setting !== "none" && motion;
}

export { revealOrder };

// Every roster slot is one row high (SLOT), filled or not: a team card holds team-size slots
// (August's fixed team boxes), so the cards keep their height while names land and leave.
// Slots keep their icon and their look while they cannot add (connecting, offline, a draw
// landing), so nothing shifts when adding comes back (owner, 2026-09-27); dimming them read as
// broken (owner, 2026-09-28), so only the header's Add shows the wait. Everyone on the dashboard
// is a member who can write once connected.
// Each is its own place (owner, 2026-09-28): adding here, or dropping a player here, puts them
// in this slot, not after the team's last row.
function EmptySlot({ n }: { n: number }) {
  const add = useContext(TeamAddContext);
  const moveTo = useMoveTo();
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      data-slot-add
      data-add-target
      disabled={!add?.can}
      onClick={(e) => add?.open(e.currentTarget, n)}
      onDragOver={(e) => {
        if (!add?.can || !draggedPlayer()) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const d = draggedPlayer();
        setOver(false);
        if (!add?.can || !d) return;
        e.preventDefault();
        e.stopPropagation();
        void moveTo(d, add.team, n);
      }}
      className={cn(
        EMPTY_SLOT,
        "outline-none enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
        over && "bg-accent",
      )}
    >
      <EmptySlotBody n={n} />
    </button>
  );
}

// A team card's Add (owner, 2026-09-23): a waiting player straight into this team, or a new one
// through Add player, which then moves them here. It opens on what was clicked: the header's
// button, the empty slot itself (owner, 2026-09-27), or a row's Add player above / below, which
// lands the player in that row's slot or the next (D37, slots since 0028).
function AddToTeam({ team, at, slot, onClose }: { team: 1 | 2; at: HTMLElement | null; slot?: number; onClose: () => void }) {
  const { t } = useT();
  const ui = useUi();
  const moveTo = useMoveTo();
  const riot = useRiotIds();
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
                  <CommandItem key={p.id} value={`${p.kick_username} ${p.riot_id ?? ""}`} onSelect={pick(() => void moveTo(p, team, slot))}>
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
                  ui.setAddAt(slot ?? null);
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

// One name landing: typed in with Typewriter, its protected tag rising with it. `typed={false}`
// shows it at once, for a name a pick's Cards, List or Wheel has just revealed.
export function LandingName({ entry, at, typed = true, children }: { entry: DrawEntry; at: number; typed?: boolean; children?: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-row-edge bg-background px-4 py-3", SLOT)}>
      {typed ? (
        <Typed text={entry.kick_username} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={at} className="text-name" />
      ) : (
        <span className="text-name">{entry.kick_username}</span>
      )}
      {entry.locked && (
        <span className="animate-enter" style={{ animationDelay: `${at}ms` }}>
          <Tag tone="brand" icon={ShieldCheck}>{t("tag.protected")}</Tag>
        </span>
      )}
      {children}
    </div>
  );
}

function TeamCard({ team, count, size, avg, landing = false, victory, children }: {
  team: 1 | 2;
  count: number;
  size: number;
  avg?: React.ReactNode;
  // A draw is landing in the rosters: adding waits, its controls disabled rather than gone
  // (owner, 2026-09-28).
  landing?: boolean;
  victory?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const moveTo = useMoveTo();
  const canWrite = useCanWrite();
  const [over, setOver] = useState(false);
  // A player dragged over a full team is refused, and the header says so (DESIGN.md § Drag).
  const [refused, setRefused] = useState(false);
  // Each opening is its own list (a new key), so a second target opens a fresh list there
  // instead of sliding the open one across; the same target again closes it.
  const [add, setAdd] = useState<{ at: HTMLElement; n: number; slot?: number } | null>(null);
  const openAt = useCallback(
    (at: HTMLElement, slot?: number) => setAdd((a) => (a?.at === at ? null : { at, slot, n: (a?.n ?? 0) + 1 })),
    [],
  );
  const canAdd = !landing && canWrite && count < size;
  const rowAdd = useMemo(() => ({ team, size, open: openAt, full: count >= size, can: canAdd }), [team, size, openAt, count, canAdd]);
  // Drop target for a player of the other team, or anyone dragged here (August's team boxes).
  const takes = (d: ReturnType<typeof draggedPlayer>) => !!d && !(d.status === "playing" && d.team === team);
  const card = (
    <TeamCardView
      team={team}
      data-team-card
      onDragOver={(e) => {
        if (!takes(draggedPlayer())) return;
        if (count >= size) return setRefused(true);
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOver(false);
          setRefused(false);
        }
      }}
      onDrop={(e) => {
        const d = draggedPlayer();
        setOver(false);
        if (!d || !takes(d)) return;
        e.preventDefault();
        void moveTo(d, team);
      }}
      className={cn(over && (team === 1 ? "ring-2 ring-team-1/60" : "ring-2 ring-team-2/60"))}
      head={
        refused ? (
          <span role="status" className="text-destructive">
            {t("why.team_full", { team: t(`team.${team}`), n: count, size })}
          </span>
        ) : (
          // No colour square: the card's top edge carries the team colour.
          <span className="flex min-w-0 items-center gap-3">
            <TeamCount count={count} size={size} />
            {avg}
          </span>
        )
      }
      actions={
        <>
          {victory}
          <Tip
            label={
              !canWrite
                ? t("why.offline")
                : landing
                  ? t("why.draw_landing")
                  : count >= size
                    ? t("why.team_full", { team: t(`team.${team}`), n: count, size })
                    : null
            }
          >
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
          </Tip>
        </>
      }
    >
      <AddToTeam key={add?.n ?? 0} team={team} at={add?.at ?? null} slot={add?.slot} onClose={() => setAdd(null)} />
      <TeamAddContext.Provider value={rowAdd}>{children}</TeamAddContext.Provider>
    </TeamCardView>
  );
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
  const playing = players.filter((p) => p.status === "playing").length;
  const { shuffle, clearTeams } = useDrawActions();
  const riot = useRiotIds();
  return (
    <ContextMenuContent className="min-w-60 p-1.5">
      <ContextMenuLabel className={cn("font-normal", team === 1 ? "text-team-1" : "text-team-2")}>
        {t(`team.${team}`)}{" "}
        <span className="ml-1.5 text-muted-foreground tabular-nums">
          {/* Counts are Newsreader (DESIGN.md § Type), gold when the team is full. */}
          {t("teams.count", { size })
            .split("{n}")
            .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className={cn("font-serif font-medium", count >= size && "text-brand")}>{count}</span>, part]))}
        </span>
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
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!canWrite || playing === 0} onSelect={() => void clearTeams()}>
        <UsersRound aria-hidden />
        {t("action.clear_teams")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
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

// A team player dropped on the page's blank space leaves the team for waiting (owner,
// 2026-09-27). Cards, rows and fields keep their own drops; the Teams tab is mounted only while open.
function useDropOut() {
  const act = useAct();
  useEffect(() => {
    const out = (e: DragEvent) => {
      const d = draggedPlayer();
      const el = e.target as HTMLElement | null;
      return !e.defaultPrevented && d?.status === "playing" && !el?.closest("[data-team-card], [data-row], input, textarea") ? d : null;
    };
    const over = (e: DragEvent) => {
      if (!out(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    };
    const drop = (e: DragEvent) => {
      const d = out(e);
      if (!d) return;
      e.preventDefault();
      void act("move_player", { p_player: d.id, p_status: "waiting", p_team: null }, {
        optimistic: { ids: [d.id], patch: (x) => ({ ...x, status: "waiting", team: null }) },
        done: "done.waiting",
        vars: { name: d.kick_username },
      });
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, [act]);
}

export function TeamsTab() {
  useDropOut();
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const act = useAct();
  const players = useQueue((v) => v.players);
  const size = useQueue((v) => v.settings.team_size);
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const reveal = useQueue((v) => v.reveal);
  const motion = useRevealMotion();
  const { draw: drawTeams, shuffle, clearTeams, pick } = useDrawActions();
  const picking = usePick();
  const playing = useQueue((v) => v.players.filter((p) => p.status === "playing").length);

  const rosters = useMemo(
    () => ([1, 2] as const).map((n) => players.filter((p) => p.status === "playing" && p.team === n)),
    [players],
  );
  const revealing = motion && reveal?.kind === "teams" ? reveal : null;
  const landing = useLanding(revealing, rosters);
  const current = useQueue((v) => v.draw);
  const shields = useMemo(() => shieldsOf(current), [current]);
  const e3 = enter(ui.entering, 3);
  const e4 = enter(ui.entering, 4);
  const offline = !canWrite ? t("why.offline") : null;
  const riot = useRanks();
  const score = useQueue((v) => v.score);
  const store = useStore();
  // One press, one game: a second press before the first returns would send the same base and
  // come back as someone else's game.
  const [recording, setRecording] = useState(false);
  const victory = (team: 1 | 2) => {
    setRecording(true);
    void act("record_game", { p_winner: team, p_base: store.get().games[0]?.id ?? null }, { done: "done.victory", vars: { team: t(`team.${team}`) } })
      .then((r) => {
        if (!isError(r) && r.kind === "game_stale") toast(t("game.stale"));
      })
      .finally(() => setRecording(false));
  };
  const victoryWhy =
    offline ??
    (landing ? t("why.draw_landing") : rosters.some((r) => r.length === 0) ? t("why.victory_empty") : recording ? t("why.victory_pending") : null);

  return (
    <div className="flex flex-col gap-6">
      {/* Team 1 over its card on the left, vs in the middle, team 2 on the right (owner, 2026-09-23). */}
      <div style={e3.style} className={cn("flex flex-col gap-1", e3.className)}>
        <h2 className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-4 font-serif text-headline max-md:text-title">
          <span className="truncate text-team-1 selection:bg-team-1 selection:text-background">{t("team.1")}</span>
          {/* A scoreboard: once a game is recorded this stream each team's number flanks the vs
              on its side, in its colour (owner, 2026-09-28). */}
          <span className="flex items-baseline gap-4 max-md:gap-3">
            {score.t1 + score.t2 > 0 && <span className="font-medium text-team-1 tabular-nums">{score.t1}</span>}
            <span className="text-title text-muted-foreground italic max-md:text-body">{t("match.vs")}</span>
            {score.t1 + score.t2 > 0 && <span className="font-medium text-team-2 tabular-nums">{score.t2}</span>}
          </span>
          <span className="truncate text-right text-team-2 selection:bg-team-2 selection:text-background">{t("team.2")}</span>
        </h2>
      </div>

      <div style={e4.style} className={cn(TEAMS_GRID, e4.className)}>
        {landing && <RevealEnd key={revealing!.id} duration={landing.duration} />}
        {rosters.map((roster, i) => (
          <Fragment key={i}>
            {/* Stacked cards (under 1024px) get the vs between them (D25). */}
            {i === 1 && (
              <p aria-hidden className="-my-2 text-center font-serif text-title text-muted-foreground italic lg:hidden">
                {t("match.vs")}
              </p>
            )}
            <TeamCard
              team={(i + 1) as 1 | 2}
              count={roster.length}
              size={size}
              avg={!landing && riot && <Avg players={roster} />}
              landing={!!landing}
              victory={
                // In the card's header, one press marks the winner; the after-game action is
                // Settings' default and Undo in the toast takes it back (D27, owner 2026-09-27: no menu).
                <Tip label={victoryWhy}>
                  <Button
                    variant="outline"
                    size="lg"
                    className={cn("max-md:h-11", i === 0 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2")}
                    disabled={!!victoryWhy}
                    onClick={() => victory((i + 1) as 1 | 2)}
                  >
                    <Trophy aria-hidden />
                    {t("action.victory")}
                  </Button>
                </Tip>
              }
            >
              {slotLayout(roster, size).map((p, n) => {
                if (!p) return <EmptySlot key={`slot-${n}`} n={n + 1} />;
                const at = landing?.at.get(p.id);
                return (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    number={n + 1}
                    variant="roster"
                    landAt={at}
                    shield={shieldFor(shields, landing, p.id)}
                    enterStyle={at === undefined ? undefined : { className: "animate-enter", style: { animationDelay: `${at}ms` } }}
                  />
                );
              })}
            </TeamCard>
          </Fragment>
        ))}
      </div>

      <div className={TEAMS_BAR}>
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
        <div className={TEAMS_BAR_BUTTONS}>
          {/* A disabled button says why (D25). */}
          <Tip label={offline ?? (playing === 0 ? t("why.teams_empty") : null)}>
            <Button variant="destructive" size="lg" className="max-md:h-11" disabled={!canWrite || playing === 0} onClick={() => void clearTeams()}>
              {t("action.clear_teams")}
            </Button>
          </Tip>
          <Tip label={offline ?? (playing < 2 ? t("why.shuffle_two") : null)}>
            <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite || playing < 2} onClick={() => void shuffle()}>
              {t("action.shuffle_teams")}
            </Button>
          </Tip>
          <DropdownMenu>
            <Tip label={offline ?? (picking.pool === 0 ? t("why.pick_none") : null)}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite || picking.pool === 0}>
                  {t("action.pick")}
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="min-w-44 p-1.5">
              {picking.sizes.map((n) => (
                <DropdownMenuItem key={n} onSelect={() => void pick(n, picking.source)}>
                  {t("action.pick.n", { n })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tip label={offline}>
            <Button size="lg" className="max-md:hidden" disabled={!canWrite} onClick={() => void drawTeams()}>
              {t("action.draw")}
            </Button>
          </Tip>
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
