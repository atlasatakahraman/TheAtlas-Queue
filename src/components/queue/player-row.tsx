"use client";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowLeftRight,
  ArrowUpToLine,
  Ban,
  Clock,
  Coffee,
  Copy,
  Ellipsis,
  Gamepad2,
  Heart,
  Hourglass,
  type LucideIcon,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { createContext, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { useAct, useCanWrite, useQueue, useServerActions, useStore } from "@/components/queue/store";
import { useUi } from "@/components/queue/ui";
import { NameText, PlayerAvatar, RankText, Tag } from "@/components/queue/team-card";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tip } from "@/components/tip";
import { Skeleton } from "@/components/ui/skeleton";
import { CardTrigger } from "@/components/queue/player-card";
import { type SortKey, useQueueSort } from "@/components/queue/sort";
import { useIsTouch } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { cn } from "@/lib/utils";
import type { Player, Sanction } from "@/types/queue";
import { MID, ROW, ROW_BUTTONS, ROW_ROSTER, TABLE_HEAD, WIDE, tableCols } from "@/components/queue/geometry";

// Drawn by the shared team card module; exported here too, where the dashboard has always found them.
export { PlayerAvatar, PROFILE_ICON, RankText, Tag } from "@/components/queue/team-card";

// Riot IDs are the master switch (owner, 2026-09-28): Require Riot ID shows and asks for them;
// ranks (Look up ranks) need it on as well.
export const useRiotIds = () => useQueue((v) => v.settings.require_riot_id);
export const useRanks = () => useQueue((v) => v.settings.require_riot_id && v.settings.riot_enabled);

// A rank on its way (D25): a Riot ID not yet looked up, for its first minute (a lookup that
// found nothing leaves no mark, so after that the cell shows what it has).
const PENDING_MS = 60_000;
export const rankPending = (p: Player, now: number) =>
  !!p.riot_id && !p.puuid && now > 0 && now - Date.parse(p.joined_at) < PENDING_MS;
export function useRankPending(p: Player) {
  const ranks = useRanks();
  return rankPending(p, useNow(5_000)) && ranks;
}

export function activeSanctions(moderation: Sanction[], name: string) {
  const n = name.toLowerCase();
  const now = Date.now();
  const live = moderation.filter(
    (m) =>
      m.kick_username.toLowerCase() === n &&
      !m.revoked_at &&
      (!m.expires_at || Date.parse(m.expires_at) > now) &&
      (m.games_left === null || m.games_left > 0),
  );
  return {
    warned: live.some((m) => m.kind === "warn"),
    banned: live.some((m) => m.kind === "ban"),
    punish: live.find((m) => m.kind === "punish"),
  };
}

// What is left of the punishment that seats a player in Punished: games, or the time it ends.
function PunishedTag({ punish }: { punish?: Sanction }) {
  const { t, lang } = useT();
  const left =
    punish?.games_left != null
      ? t("tag.punished.games", { n: punish.games_left })
      : punish?.expires_at
        ? t("tag.punished.until", {
            time: new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(punish.expires_at)),
          })
        : t("tag.punished");
  return <Tag fold tone="warning" icon={Hourglass}>{left}</Tag>;
}

export function PlayerTags({ player, showState = true }: { player: Player; showState?: boolean }) {
  const { t } = useT();
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const moderation = useQueue((v) => v.moderation);
  const s = activeSanctions(moderation, player.kick_username);
  return (
    <>
      {player.locked ? (
        <Tag fold tone="brand" icon={ShieldCheck}>{t("tag.protected")}</Tag>
      ) : (
        player.is_subscriber && <Tag fold tone="brand" icon={Star}>{t("tag.sub")}</Tag>
      )}
      {showState && player.status === "playing" && (
        <Tag fold tone={player.team === 2 ? "team-2" : "team-1"} icon={Gamepad2}>{t("tag.in_game")}</Tag>
      )}
      {showState && player.status === "away" && <Tag fold tone="muted" icon={Coffee}>{t("tag.away")}</Tag>}
      {player.status === "punished" && <PunishedTag punish={s.punish} />}
      {fairPlay && player.games_played === 0 && <Tag fold tone="success" icon={Sparkles}>{t("tag.first_game")}</Tag>}
      {s.warned && <Tag fold tone="warning" icon={TriangleAlert}>{t("tag.warned")}</Tag>}
      {s.banned && <Tag fold tone="destructive" icon={Ban}>{t("tag.banned")}</Tag>}
    </>
  );
}

// Free places on a team: the menu, the hover buttons and Pick disable a move that would not fit.
export function useTeamRoom() {
  const size = useQueue((v) => v.settings.team_size);
  const n1 = useQueue((v) => v.players.filter((x) => x.status === "playing" && x.team === 1).length);
  const n2 = useQueue((v) => v.players.filter((x) => x.status === "playing" && x.team === 2).length);
  return (n: 1 | 2) => size - (n === 1 ? n1 : n2);
}

// Every copy on the dashboard (row menu, palette, player card) says what it copied (owner,
// 2026-09-28). Resolves whether it worked.
export function useCopy() {
  const { t } = useT();
  return (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => (toast(t("done.copied", { text })), true),
      () => (toast.error(t("error.generic")), false),
    );
}

// The row's actions, shared by the menu, the row keys and the command palette.
export function usePlayerActions(p: Player) {
  const { t } = useT();
  const act = useAct();
  const store = useStore();
  const ui = useUi();
  const team = (n: 1 | 2) => t(`team.${n}`);
  const move = (status: Player["status"], teamNo: 1 | 2 | null) =>
    act("move_player", { p_player: p.id, p_status: status, p_team: teamNo }, {
      optimistic: { ids: [p.id], patch: (x) => ({ ...x, status, team: teamNo }) },
      done: status === "playing" ? "done.move_team" : status === "away" ? "done.away" : "done.waiting",
      vars: { name: p.kick_username, team: teamNo ? team(teamNo) : "" },
    });
  const copy = useCopy();
  const moveToTeam = useMoveTo();
  return {
    moveTo: (n: 1 | 2) => moveToTeam(p, n),
    toWaiting: () => move("waiting", null),
    toggleAway: () => (p.status === "away" ? move("waiting", null) : move("away", null)),
    remove: () =>
      act("remove_players", { p_ids: [p.id] }, {
        optimistic: { ids: [p.id], patch: () => null },
        done: "done.remove",
        vars: { name: p.kick_username },
      }),
    // Lift the punishment that seats them in Punished; settle sends them back to waiting.
    lift: () => {
      const m = activeSanctions(store.get().moderation, p.kick_username).punish;
      if (m) void act("revoke_sanction", { p_id: m.id }, { done: "done.revoke", vars: { name: p.kick_username } });
    },
    removeProtection: () =>
      act("remove_protection", { p_player: p.id }, { done: "done.unprotect", vars: { name: p.kick_username } }),
    warn: () => ui.setSanction({ name: p.kick_username, kind: "warn" }),
    punish: () => ui.setSanction({ name: p.kick_username, kind: "punish" }),
    ban: () => ui.setSanction({ name: p.kick_username, kind: "ban" }),
    edit: () => ui.setEditing(p),
    copyRiot: () => p.riot_id && copy(p.riot_id),
    copyName: () => copy(p.kick_username),
  };
}

export type Item = {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
  destructive?: boolean;
  // A team item's icon and label take the team colour (August's blue/red "add to team").
  tone?: string;
  write?: boolean;
  disabled?: boolean;
};

// Refresh rank (D22, D31): at most once a minute a player, checked on the server.
export function useRefreshRank(p: Player) {
  const { t } = useT();
  const store = useStore();
  const { refreshRank } = useServerActions();
  return () =>
    void refreshRank(store.get().channel.id, p.id).then((r) =>
      r === "ok"
        ? toast(t("done.refresh_rank", { name: p.kick_username }))
        : toast.error(t(r === "recent" ? "refresh.recent" : "refresh.failed")),
    );
}

// The row menu's sections, also the palette's page for one player.
export function usePlayerMenu(p: Player): Item[][] {
  const { t } = useT();
  const a = usePlayerActions(p);
  const riot = useRiotIds();
  const ranks = useRanks();
  const ui = useUi();
  const store = useStore();
  const refresh = useRefreshRank(p);
  const teamAdd = useContext(TeamAddContext);
  const room = useTeamRoom();
  const punished = p.status === "punished";
  // Add player above / below (D37): a team row opens its card's add list on the row; a queue row
  // opens Add player. Either lands at the key beside this row.
  const addBeside = (at: "before" | "after") => () => {
    if (teamAdd) {
      const row = document.querySelector<HTMLElement>(`[data-player="${p.id}"]`);
      // The closing menu would hand focus back to its trigger and dismiss the list it opened.
      keepFocus = true;
      if (row) teamAdd.open(row, slotBeside(p, at, teamAdd.size));
      return;
    }
    ui.setAddAt(placeKey(store.get().players, p.id, at));
    ui.setAdding(true);
  };
  // Each kind of action its own section (owner, 2026-09-28): copy, edit, place, team, state,
  // protection, sanctions, remove.
  const groups: Item[][] = [
    [
      ...(riot && p.riot_id ? [{ label: t("menu.copy_riot"), icon: Copy, onSelect: a.copyRiot }] : []),
      { label: t("menu.copy_name"), icon: Gamepad2, onSelect: a.copyName },
    ],
    [
      { label: t("menu.edit"), icon: Pencil, onSelect: a.edit, write: true },
      // D22: the rank again, on demand; at most once a minute a player (server-checked).
      {
        label: t("menu.refresh_rank"),
        icon: RefreshCw,
        write: true,
        disabled: !ranks || !p.riot_id,
        onSelect: refresh,
      },
    ],
    [
      { label: t("menu.add_above"), icon: ArrowUpToLine, onSelect: addBeside("before"), write: true, disabled: teamAdd?.full },
      { label: t("menu.add_below"), icon: ArrowDownToLine, onSelect: addBeside("after"), write: true, disabled: teamAdd?.full },
    ],
    [
      // Both teams always listed, disabled when already there or full, so the menu keeps its shape
      // (owner, 2026-09-27).
      { label: t("menu.move_to", { team: t("team.1") }), icon: UserPlus, onSelect: () => a.moveTo(1), tone: "text-team-1", write: true, disabled: punished || p.team === 1 || room(1) < 1 },
      { label: t("menu.move_to", { team: t("team.2") }), icon: UserPlus, onSelect: () => a.moveTo(2), tone: "text-team-2", write: true, disabled: punished || p.team === 2 || room(2) < 1 },
    ],
    [
      ...(punished ? [{ label: t("menu.lift"), icon: Undo2, onSelect: a.lift, write: true }] : []),
      ...(p.status === "playing" ? [{ label: t("menu.to_waiting"), icon: Undo2, onSelect: a.toWaiting, write: true }] : []),
      ...(p.status !== "playing"
        ? [{ label: p.status === "away" ? t("menu.back") : t("menu.away"), icon: Coffee, onSelect: a.toggleAway, write: true, disabled: punished }]
        : []),
    ],
    p.locked ? [{ label: t("menu.unprotect"), icon: ShieldOff, onSelect: a.removeProtection, write: true }] : [],
    [
      { label: t("menu.warn"), icon: TriangleAlert, onSelect: a.warn, tone: "text-warning", write: true },
      { label: t("menu.punish"), icon: Hourglass, onSelect: a.punish, tone: "text-warning", write: true },
      { label: t("menu.ban"), icon: Ban, onSelect: a.ban, destructive: true, write: true },
    ],
    [{ label: t("menu.remove"), icon: Trash2, shortcut: "Del", onSelect: () => void a.remove(), destructive: true, write: true }],
  ];
  return groups.filter((g) => g.length > 0);
}

function RowMenu({ player, kit, open, onOpenChange }: { player: Player; kit: "context" | "dropdown"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const { t } = useT();
  const groups = usePlayerMenu(player);
  const canWrite = useCanWrite();
  const riot = useRiotIds();
  const K =
    kit === "context"
      ? { Item: ContextMenuItem, Sep: ContextMenuSeparator, Short: ContextMenuShortcut, Label: ContextMenuLabel }
      : { Item: DropdownMenuItem, Sep: DropdownMenuSeparator, Short: DropdownMenuShortcut, Label: DropdownMenuLabel };
  const items = groups.map((g, i) => (
    <div key={i} role="group">
      {i > 0 && <K.Sep />}
      {g.map((it) => (
        <K.Item
          key={it.label}
          variant={it.destructive ? "destructive" : "default"}
          disabled={(it.write && !canWrite) || it.disabled}
          onSelect={it.onSelect}
          className={cn(it.tone, it.tone && "focus:text-current [&_svg]:text-current!")}
        >
          <it.icon aria-hidden />
          {it.label}
          {it.shortcut && (
            <K.Short className="tracking-normal">
              <Kbd className="border border-row-edge bg-transparent">{it.shortcut}</Kbd>
            </K.Short>
          )}
        </K.Item>
      ))}
    </div>
  ));
  // The header names who the menu acts on: the Riot ID when there is one (August's menu header).
  const header = (
    <K.Label className="truncate font-mono text-code font-normal text-muted-foreground">{(riot && player.riot_id) || player.kick_username}</K.Label>
  );
  if (kit === "context")
    return (
      <ContextMenuContent className="min-w-60 p-1.5" onCloseAutoFocus={releaseFocus}>
        {header}
        {items}
      </ContextMenuContent>
    );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tip label={t("menu.open", { name: player.kick_username })}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("menu.open", { name: player.kick_username })}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-60 p-1.5" onCloseAutoFocus={releaseFocus}>
        {header}
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Respect (spec § Respect score): 100 is a clean record.
export function RespectBadge({ name, fixed }: { name: string; fixed?: number }) {
  const { t } = useT();
  // `fixed`: a score from outside the queue (the credit's maker keeps 100).
  const stored = useQueue((v) => v.respect[name.toLowerCase()]);
  const score = fixed ?? stored ?? 100;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The score, then the heart (owner, 2026-09-27): the figure is what the eye compares. */}
        <span className="tabular-nums [&>span]:flex-row-reverse">
          <Tag tone={score >= 80 ? "success" : score >= 50 ? "warning" : "destructive"} icon={Heart}>
            {score}
          </Tag>
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("mod.respect", { n: score })}</TooltipContent>
    </Tooltip>
  );
}

function WinRate({ player }: { player: Player }) {
  const { t } = useT();
  const w = player.rank?.wins;
  const l = player.rank?.losses;
  if (w == null || l == null || w + l === 0) return <span className="text-meta text-muted-foreground">—</span>;
  const pct = Math.round((w / (w + l)) * 100);
  return (
    <Tip label={t("row.record", { w, l })}>
      <span className={cn("text-meta tabular-nums", pct >= 50 ? "text-success" : "text-muted-foreground")}>{pct}%</span>
    </Tip>
  );
}

function Joined({ player }: { player: Player }) {
  const { lang } = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-muted-foreground tabular-nums" suppressHydrationWarning>
      <Clock className="size-3.5" aria-hidden />
      {new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(player.joined_at))}
    </span>
  );
}

// The name: the Riot game name with its #TAG under it (August's queue), the Kick name when
// there is no Riot ID. It opens the player card (D31); with no Riot ID and Riot IDs off there is
// no card.
function PlayerName({ player, seen, stacked, typeAt, keyboard }: { player: Player; seen: Player; stacked: boolean; typeAt?: number; keyboard: boolean }) {
  const required = useRiotIds();
  const name = <NameText player={seen} stacked={stacked} typeAt={typeAt} />;
  if (!seen.riot_id && !required) return name;
  return (
    <CardTrigger player={player} seen={seen} keyboard={keyboard}>
      <button type="button" tabIndex={-1} className="flex min-w-0 text-left outline-none">
        {name}
      </button>
    </CardTrigger>
  );
}

// Row buttons (D34, DESIGN.md § Queue table): the common moves without the menu. Waiting or away:
// add to each team (UserPlus in its colour, the team's own name in the tooltip; owner 2026-09-28:
// no numbers, the streamer names the teams) and remove; in a team: to the other team, back to waiting,
// remove. Dim at rest, full on row hover or focus; on touch always full at 44px. A disabled button
// says why in its tooltip.
function QuickActions({ player }: { player: Player }) {
  const { t } = useT();
  const a = usePlayerActions(player);
  const canWrite = useCanWrite();
  const touch = useIsTouch();
  const room = useTeamRoom();
  const size = useQueue((v) => v.settings.team_size);
  const punished = player.status === "punished";
  const tone = (n: 1 | 2) => (n === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2");
  const full = (n: 1 | 2) => (room(n) < 1 ? t("why.team_full", { team: t(`team.${n}`), n: size - room(n), size }) : null);
  type Move = { label: string; body: React.ReactNode; tone: string; run: () => unknown; why?: string | null };
  const other = player.team === 1 ? 2 : 1;
  const moves: Move[] = player.team
    ? [
        { label: t("menu.move_to", { team: t(`team.${other}`) }), body: <ArrowLeftRight aria-hidden />, tone: tone(other), run: () => a.moveTo(other), why: full(other) },
        { label: t("menu.to_waiting"), body: <Undo2 aria-hidden />, tone: "text-muted-foreground", run: a.toWaiting },
      ]
    : ([1, 2] as const).map((n) => ({
        label: t("teams.add", { team: t(`team.${n}`) }),
        body: <UserPlus aria-hidden />,
        tone: tone(n),
        run: () => a.moveTo(n),
        why: punished ? t("why.punished") : full(n),
      }));
  moves.push({ label: t("menu.remove"), body: <X aria-hidden />, tone: "text-muted-foreground hover:text-destructive", run: a.remove });
  return (
    <span className="flex items-center">
      {moves.map(({ label, body, tone, run, why }) => {
        const off = !canWrite || !!why;
        return (
          <Tip key={label} label={!canWrite ? t("why.offline") : (why ?? label)}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                tone,
                touch
                  ? "size-11"
                  : "opacity-40 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100",
              )}
              disabled={off}
              aria-label={label}
              onClick={() => void run()}
            >
              {body}
            </Button>
          </Tip>
        );
      })}
    </span>
  );
}

// Drag and drop (August's sortable queue and rosters), native: a row drags onto another row to
// take its place, or onto the other team's card to change team. Where there is no hover there
// is no drag; the menu and the row keys do the same.
let dragging: Player | null = null;
export const draggedPlayer = () => dragging;
// While a drag is on, <html data-dragging> stretches every row's hit area over the gaps
// (globals.css), so the pointer never falls between targets. Cleared on drop or dragend at the
// window, since the source row may have moved out of the DOM by then.
function startDrag(p: Player) {
  dragging = p;
  document.documentElement.dataset.dragging = "";
  // After the drop's own handlers, which still read the dragged player.
  const later = () => setTimeout(end);
  const end = () => {
    dragging = null;
    delete document.documentElement.dataset.dragging;
    window.removeEventListener("drop", later, true);
    window.removeEventListener("dragend", end, true);
  };
  window.addEventListener("drop", later, true);
  window.addEventListener("dragend", end, true);
}

// Set when a menu item opens a team's add list, so the menu does not take focus back on close.
let keepFocus = false;
const releaseFocus = (e: Event) => {
  if (keepFocus) e.preventDefault();
  keepFocus = false;
};

// A team card's add list, for its rows' Add player above / below (D37). Null outside a card.
export const TeamAddContext = createContext<{
  team: 1 | 2;
  size: number;
  open: (row: HTMLElement, slot?: number) => void;
  full: boolean;
  // Adding is possible now (not full, not offline, no draw landing).
  can: boolean;
} | null>(null);

// Into a team, at slot when given (owner, 2026-09-28: the empty slot clicked, the row dropped on;
// a taken slot is inserted into, the others pushed on by the server, 0028). Without one (Add to
// Team N, a drop on the card, a menu's Move to) the player takes the first empty slot. One write,
// one Undo.
export function useMoveTo() {
  const { t } = useT();
  const act = useAct();
  return (p: Player, team: 1 | 2, slot?: number) =>
    act("move_player", { p_player: p.id, p_status: "playing", p_team: team, p_slot: slot ?? null }, {
      optimistic: {
        ids: [p.id],
        patch: (x) => ({ ...x, status: "playing", team, team_slot: slot ?? (x.team === team ? x.team_slot : null) }),
      },
      done: "done.move_team",
      vars: { name: p.kick_username, team: t(`team.${team}`) },
    });
}

// The slot beside a roster row: its own (above, pushing it on) or the next (below), at most the
// team's size.
export const slotBeside = (p: Player, at: "before" | "after", size: number) =>
  Math.min((p.team_slot ?? 1) + (at === "after" ? 1 : 0), size);

// The edge of row the pointer is on, or null where dropping d would leave it in its own slot
// (the rows as drawn).
function edgeAt(e: React.DragEvent<HTMLElement>, d: Player): "before" | "after" | null {
  const row = e.currentTarget;
  const r = row.getBoundingClientRect();
  const at = e.clientY < r.top + r.height / 2 ? "before" : "after";
  const rows = Array.from(row.closest("[data-rows]")?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
  const i = rows.indexOf(row);
  return rows[at === "before" ? i - 1 : i + 1]?.dataset.player === d.id ? null : at;
}

// The new place is the midpoint between the target and its neighbour on that side.
// The key between target and its neighbour on that side, leaving out the player being moved.
export function placeKey(players: Player[], targetId: string, at: "before" | "after", movingId?: string) {
  const list = players.filter((p) => p.id !== movingId);
  const i = list.findIndex((p) => p.id === targetId);
  const target = list[i];
  const nb = list[at === "before" ? i - 1 : i + 1];
  return nb ? (target.sort_key + nb.sort_key) / 2 : target.sort_key + (at === "before" ? -1 : 1);
}

function useReorder() {
  const act = useAct();
  const store = useStore();
  return (d: Player, target: Player, at: "before" | "after") => {
    const key = placeKey(store.get().players, target.id, at, d.id);
    return act("reorder_player", { p_player: d.id, p_key: key }, {
      optimistic: { ids: [d.id], patch: (x) => ({ ...x, sort_key: key }) },
      done: "done.reorder",
      vars: { name: d.kick_username },
    });
  };
}

// A player row (DESIGN.md § Recipes → Queue row). "table" is the Queue tab's row; "roster" is a
// team card's row: number, avatar, name#tag, rank, menu, on the floor colour.
export function PlayerRow({
  player,
  number,
  variant = "table",
  arrivedAt,
  revertedAt,
  enterStyle,
  landAt,
  sorted = false,
}: {
  player: Player;
  number?: number;
  variant?: "table" | "roster";
  arrivedAt?: number;
  revertedAt?: number;
  enterStyle?: { className?: string; style?: React.CSSProperties };
  /** A fresh draw landing this row: it rises in at this many ms and types its name. */
  landAt?: number;
  /** A column sort is on (D35): the row does not drag. */
  sorted?: boolean;
}) {
  const a = usePlayerActions(player);
  const canWrite = useCanWrite();
  const [menuOpen, setMenuOpen] = useState(false);
  // The arrival fade and the revert highlight play for events after (or just before) this row
  // mounted, so a tab switch does not replay them.
  const [mountedAt] = useState(() => Date.now());
  const recent = (at?: number) => !!at && at > mountedAt - 2000;
  const table = variant === "table";
  const ids = useRiotIds();
  const ranks = useRanks();
  // What the row shows: no Riot ID with Riot IDs off, no rank or profile icon with ranks off,
  // though the player keeps them (actions and the edit dialog get the real player, so nothing
  // stored is lost).
  const seen = useMemo(
    () => (ranks ? player : { ...player, riot_id: ids ? player.riot_id : null, rank: null }),
    [ids, ranks, player],
  );
  const touch = useIsTouch();
  const reorder = useReorder();
  const moveTo = useMoveTo();
  const teamAdd = useContext(TeamAddContext);
  const [dropAt, setDropAt] = useState<"before" | "after" | null>(null);
  const [lifted, setLifted] = useState(false);
  const pending = useRankPending(player);
  // The row resting under keyboard focus opens its card (D31), as the pointer's stillness does.
  const [kbd, setKbd] = useState(false);
  const draggable = canWrite && !touch && !sorted && player.status !== "punished";
  // A roster row takes its own team's players (a reorder) and, while the team has room, anyone
  // else, who joins the team at that row (D37, owner 2026-09-27).
  const sameTeam = (d: Player) => d.status === "playing" && d.team === player.team;
  // A punished row neither drags nor takes a drop beside it: its place is held for when the
  // punishment ends (owner, 2026-09-28).
  const accepts = (d: Player | null): d is Player =>
    !!d && d.id !== player.id && player.status !== "punished" && (table || sameTeam(d) || !teamAdd?.full);

  // Row keys fire only while the row itself has focus (DESIGN.md § Focus and keyboard).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const rows = () => Array.from(e.currentTarget.closest("[data-rows]")?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    const handled = () => e.preventDefault();
    if (k === "ArrowDown" || k === "ArrowUp") {
      const list = rows();
      const i = list.indexOf(e.currentTarget);
      list[k === "ArrowDown" ? i + 1 : i - 1]?.focus();
      return handled();
    }
    if (k === "Enter") {
      setMenuOpen(true);
      return handled();
    }
    if (k === "Delete" && canWrite) return (void a.remove(), handled());
  }

  const edge =
    player.status === "playing"
      ? player.team === 2
        ? "border-l-team-2"
        : "border-l-team-1"
      : player.status === "away"
        ? "border-l-row-edge [border-left-style:dashed]"
        : player.status === "punished"
          ? "border-l-warning [border-left-style:dashed]"
          : "border-l-row-edge";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row
          data-player={player.id}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={(e) => setKbd(e.target === e.currentTarget && e.currentTarget.matches(":focus-visible"))}
          onBlur={() => setKbd(false)}
          draggable={draggable}
          onDragStart={(e) => {
            startDrag(player);
            setLifted(true);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", player.kick_username);
            // The browser would drag a picture of the whole row: a chip follows the cursor instead
            // (D25, DESIGN.md § Drag and drop): the initial, the name and the #TAG, in the row's
            // edge. Built as text nodes, never markup, since names come from chat.
            const [game, tag] = seen.riot_id ? seen.riot_id.split("#") : [player.kick_username, null];
            const chip = document.createElement("div");
            chip.className = cn(
              "fixed -top-96 left-0 flex max-w-64 items-center gap-2 rounded-lg border border-l-[3px] border-row-edge bg-card px-3 py-1.5 text-foreground shadow-md",
              edge,
            );
            const part = (text: string, className: string) => {
              const el = document.createElement("span");
              el.textContent = text;
              el.className = className;
              chip.append(el);
            };
            part(game.slice(0, 1), "grid size-5 shrink-0 place-items-center rounded-full border border-row-edge text-caption text-muted-foreground uppercase");
            part(game, "min-w-0 truncate text-name");
            if (tag) part(`#${tag}`, "shrink-0 font-mono text-caption text-muted-foreground");
            document.body.append(chip);
            e.dataTransfer.setDragImage(chip, 16, chip.offsetHeight / 2);
            requestAnimationFrame(() => chip.remove());
          }}
          onDragEnd={() => setLifted(false)}
          onDragOver={(e) => {
            if (!accepts(dragging)) return;
            e.preventDefault();
            e.stopPropagation();
            // Say "move" outright: left to guess, Chrome can treat the drop as refused and fly the
            // ghost back to where it started before the row moves.
            e.dataTransfer.dropEffect = "move";
            // Beside its own row the drop would leave it where it is: refused, with no line.
            const at = edgeAt(e, dragging);
            if (!at) e.dataTransfer.dropEffect = "none";
            setDropAt(at);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropAt(null)}
          onDrop={(e) => {
            const d = dragging;
            setDropAt(null);
            // Read from where it lands: the line drawn last may not have rendered yet.
            const at = accepts(d) ? edgeAt(e, d) : null;
            if (!accepts(d) || !at) return;
            e.preventDefault();
            e.stopPropagation();
            if (table) void reorder(d, player, at);
            else void moveTo(d, player.team === 2 ? 2 : 1, slotBeside(player, at, teamAdd?.size ?? 5));
          }}
          style={enterStyle?.style}
          className={cn(
            "group/row relative outline-none",
            ROW,
            "transition-colors duration-150 ease-out hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            table ? cn("bg-row", tableCols(ids, ranks)) : ROW_ROSTER,
            edge,
            recent(arrivedAt) && "animate-arrive",
            recent(revertedAt) && "animate-highlight",
            // The row picked up dims at once, so the drag reads as started with no pause.
            lifted && "opacity-40",
            // The drop line: gold in the queue, the team's colour on a roster (D37).
            dropAt === "before" && (table ? "shadow-[0_-3px_0_0_var(--ring)]" : player.team === 2 ? "shadow-[0_-3px_0_0_var(--team-2)]" : "shadow-[0_-3px_0_0_var(--team-1)]"),
            dropAt === "after" && (table ? "shadow-[0_3px_0_0_var(--ring)]" : player.team === 2 ? "shadow-[0_3px_0_0_var(--team-2)]" : "shadow-[0_3px_0_0_var(--team-1)]"),
            enterStyle?.className,
          )}
        >
          <span className="font-serif text-numeral text-muted-foreground tabular-nums select-none">{number}</span>
          <div className="flex min-w-0 items-center gap-3">
            <PlayerAvatar player={seen} />
            {/* One line (D36): the name truncates first, then the tags fold to icons. */}
            <div className="@container/name flex min-w-0 flex-1 items-center gap-x-2.5">
              <PlayerName player={player} seen={seen} stacked={table} typeAt={landAt} keyboard={kbd} />
              {table && <RespectBadge name={player.kick_username} />}
              <PlayerTags player={player} showState={table} />
            </div>
          </div>
          {table && ids && <span className={cn("truncate text-meta text-muted-foreground", MID)}>{player.kick_username}</span>}
          {/* Always a cell, so rows with and without a rank keep the next columns in place. */}
          {(ranks || !table) && (
            <div className={table ? MID : "max-sm:hidden"}>
              {pending ? <Skeleton className="h-4 w-20" /> : <RankText player={seen} />}
            </div>
          )}
          {table && ranks && (
            <div className={WIDE}>
              {pending ? <Skeleton className="h-4 w-9" /> : <WinRate player={seen} />}
            </div>
          )}
          {table && (
            <span className={WIDE}>
              <Joined player={player} />
            </span>
          )}
          {/* In a narrow list the buttons take a line of their own under the name (at 375px four
              44px touch buttons left the name 27px): under 40rem of table, 24rem of roster. */}
          <span
            className={table ? ROW_BUTTONS.table : ROW_BUTTONS.roster}
          >
            <QuickActions player={player} />
            <RowMenu player={player} kit="dropdown" open={menuOpen} onOpenChange={setMenuOpen} />
          </span>
        </div>
      </ContextMenuTrigger>
      <RowMenu player={player} kit="context" />
    </ContextMenu>
  );
}

// The table's header row, on the same grid as the rows. Player, Rank, Win rate and Joined sort
// the view (D35); while sorted, # turns into the way back to the queue order.
export function TableHeader({ sort }: { sort: ReturnType<typeof useQueueSort> }) {
  const { t } = useT();
  const ids = useRiotIds();
  const ranks = useRanks();
  const th = "text-caption text-muted-foreground uppercase select-none";
  const col = (key: SortKey, label: string, className?: string) => {
    const on = sort.key === key;
    const Arrow = sort.dir === "desc" ? ArrowDown : ArrowUp;
    return (
      <span className={className}>
        <button
          type="button"
          onClick={() => sort.toggle(key)}
          aria-label={on ? t(sort.dir === "desc" ? "sort.by.desc" : "sort.by.asc", { col: label }) : t("sort.by", { col: label })}
          className={cn(th, "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40", on && "text-foreground")}
        >
          {label}
          {on && <Arrow aria-hidden className="size-3.5" />}
        </button>
      </span>
    );
  };
  return (
    <div className={cn(TABLE_HEAD, tableCols(ids, ranks))}>
      {/* While sorted, the # itself is the way back (owner, 2026-09-28): muted like the other
          headers, foreground on hover. */}
      {sort.key ? (
        // A flex cell, so the tooltip's trigger is the # and not the whole 2rem column (owner,
        // 2026-09-28: the arrow pointed past it).
        <span className="flex">
          <Tip label={t("sort.reset")}>
            <button
              type="button"
              aria-label={t("sort.reset")}
              onClick={sort.reset}
              className={cn(th, "-mx-1 w-fit rounded-sm px-1 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40")}
            >
              #
            </button>
          </Tip>
        </span>
      ) : (
        <span className={th}>#</span>
      )}
      {col("name", t("col.player"))}
      {ids && <span className={th}>{t("col.kick")}</span>}
      {ranks && col("rank", t("col.rank"))}
      {ranks && col("winrate", t("col.winrate"), WIDE)}
      {col("joined", t("col.joined"), WIDE)}
      <span />
    </div>
  );
}
