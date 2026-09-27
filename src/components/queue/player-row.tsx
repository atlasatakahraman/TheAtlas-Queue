"use client";
import {
  ArrowLeftRight,
  Ban,
  Clock,
  Coffee,
  Copy,
  Ellipsis,
  Gamepad2,
  Hourglass,
  type LucideIcon,
  Pencil,
  ShieldOff,
  Trash2,
  TriangleAlert,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { useUi } from "@/components/queue/ui";
import { REVEAL } from "@/components/queue/teams-tab";
import { Typewriter } from "@/components/typewriter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsTouch } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import type { LabelKey } from "@/lib/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Player, Sanction } from "@/types/queue";

const TIER_DOT: Record<string, string> = {
  IRON: "bg-rank-iron", BRONZE: "bg-rank-bronze", SILVER: "bg-rank-silver", GOLD: "bg-rank-gold",
  PLATINUM: "bg-rank-platinum", EMERALD: "bg-rank-emerald", DIAMOND: "bg-rank-diamond", MASTER: "bg-rank-master",
  GRANDMASTER: "bg-rank-grandmaster", CHALLENGER: "bg-rank-challenger",
};
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export function RankText({ player, className }: { player: Player; className?: string }) {
  const { t } = useT();
  const r = player.rank;
  if (!r?.tier) return null;
  const tier = t(`rank.${r.tier}` as LabelKey);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta text-muted-foreground", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", TIER_DOT[r.tier] ?? "bg-muted-foreground")} aria-hidden />
      {APEX.has(r.tier) ? `${tier} · ${r.lp ?? 0} LP` : `${tier} ${r.division ?? ""}`.trim()}
    </span>
  );
}

// Tags: word and colour, never colour alone (DESIGN.md § Recipes → Tags).
const TAG = "inline-flex shrink-0 items-center rounded-full border px-2 text-caption normal-case tracking-normal select-none";

export function Tag({ tone, children }: { tone: "brand" | "team-1" | "team-2" | "muted" | "success" | "warning" | "destructive"; children: React.ReactNode }) {
  const tones = {
    brand: "border-brand/45 text-brand",
    "team-1": "border-team-1/45 text-team-1",
    "team-2": "border-team-2/45 text-team-2",
    muted: "border-muted-foreground/45 text-muted-foreground",
    success: "border-success/45 text-success",
    warning: "border-warning/45 text-warning",
    destructive: "border-destructive/45 text-destructive",
  };
  return <span className={cn(TAG, tones[tone])}>{children}</span>;
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
  return { warned: live.some((m) => m.kind === "warn"), banned: live.some((m) => m.kind === "ban") };
}

export function PlayerTags({ player, showState = true }: { player: Player; showState?: boolean }) {
  const { t } = useT();
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const moderation = useQueue((v) => v.moderation);
  const s = activeSanctions(moderation, player.kick_username);
  return (
    <>
      {player.locked ? <Tag tone="brand">🛡 {t("tag.protected")}</Tag> : player.is_subscriber && <Tag tone="brand">🛡 {t("tag.sub")}</Tag>}
      {showState && player.status === "playing" && <Tag tone={player.team === 2 ? "team-2" : "team-1"}>{t("tag.in_game")}</Tag>}
      {showState && player.status === "away" && <Tag tone="muted">{t("tag.away")}</Tag>}
      {fairPlay && player.games_played === 0 && <Tag tone="success">{t("tag.first_game")}</Tag>}
      {s.warned && <Tag tone="warning">{t("tag.warned")}</Tag>}
      {s.banned && <Tag tone="destructive">{t("tag.banned")}</Tag>}
    </>
  );
}

// The row's actions, shared by the menu, the row keys and the command palette.
export function usePlayerActions(p: Player) {
  const { t } = useT();
  const act = useAct();
  const ui = useUi();
  const team = (n: 1 | 2) => t(`team.${n}`);
  const move = (status: Player["status"], teamNo: 1 | 2 | null) =>
    act("move_player", { p_player: p.id, p_status: status, p_team: teamNo }, {
      optimistic: { ids: [p.id], patch: (x) => ({ ...x, status, team: teamNo }) },
      done: status === "playing" ? "done.move_team" : status === "away" ? "done.away" : "done.waiting",
      vars: { name: p.kick_username, team: teamNo ? team(teamNo) : "" },
    });
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast(t("common.copied")),
      () => toast.error(t("error.generic")),
    );
  return {
    moveTo: (n: 1 | 2) => move("playing", n),
    toWaiting: () => move("waiting", null),
    toggleAway: () => (p.status === "away" ? move("waiting", null) : move("away", null)),
    remove: () =>
      act("remove_players", { p_ids: [p.id] }, {
        optimistic: { ids: [p.id], patch: () => null },
        done: "done.remove",
        vars: { name: p.kick_username },
      }),
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

type Item = {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
  destructive?: boolean;
  // A team item's icon and label take the team colour (August's blue/red "add to team").
  tone?: string;
  write?: boolean;
};

function useMenu(p: Player): Item[][] {
  const { t } = useT();
  const a = usePlayerActions(p);
  const groups: Item[][] = [
    [
      ...(p.riot_id ? [{ label: t("menu.copy_riot"), icon: Copy, onSelect: a.copyRiot }] : []),
      { label: t("menu.copy_name"), icon: Gamepad2, onSelect: a.copyName },
    ],
    [{ label: t("menu.edit"), icon: Pencil, onSelect: a.edit, write: true }],
    [
      ...(p.team !== 1
        ? [{ label: t("menu.move_to", { team: t("team.1") }), icon: UserPlus, onSelect: () => a.moveTo(1), tone: "text-team-1", write: true }]
        : []),
      ...(p.team !== 2
        ? [{ label: t("menu.move_to", { team: t("team.2") }), icon: UserPlus, onSelect: () => a.moveTo(2), tone: "text-team-2", write: true }]
        : []),
      ...(p.status === "playing" ? [{ label: t("menu.to_waiting"), icon: Undo2, onSelect: a.toWaiting, write: true }] : []),
      ...(p.status !== "playing"
        ? [{ label: p.status === "away" ? t("menu.back") : t("menu.away"), icon: Coffee, onSelect: a.toggleAway, write: true }]
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
  const groups = useMenu(player);
  const canWrite = useCanWrite();
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
          disabled={it.write && !canWrite}
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
    <K.Label className="truncate font-mono text-code font-normal text-muted-foreground">{player.riot_id ?? player.kick_username}</K.Label>
  );
  if (kit === "context")
    return (
      <ContextMenuContent className="min-w-60 p-1.5">
        {header}
        {items}
      </ContextMenuContent>
    );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("menu.open", { name: player.kick_username })}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60 p-1.5">
        {header}
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Riot profile icon, as the August queue showed it. ponytail: Data Dragon is versioned; icons
// newer than this version fall back to the initial. Bump the version when that shows.
const PROFILE_ICON = (id: number) => `https://ddragon.leagueoflegends.com/cdn/15.7.1/img/profileicon/${id}.png`;

function PlayerAvatar({ player }: { player: Player }) {
  const name = player.riot_id?.split("#")[0] || player.kick_username;
  return (
    <Avatar className="size-9 border border-row-edge">
      {player.rank?.icon != null && <AvatarImage src={PROFILE_ICON(player.rank.icon)} alt="" />}
      <AvatarFallback className="bg-transparent text-meta text-muted-foreground uppercase">{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

// Respect (spec § Respect score): 100 is a clean record.
function RespectBadge({ player }: { player: Player }) {
  const { t } = useT();
  const score = useQueue((v) => v.respect[player.kick_username.toLowerCase()]) ?? 100;
  const tone =
    score >= 80 ? "border-success/45 text-success" : score >= 50 ? "border-warning/45 text-warning" : "border-destructive/45 text-destructive";
  return (
    <span title={t("mod.respect")} className={cn(TAG, "tabular-nums", tone)}>
      {score}
    </span>
  );
}

function WinRate({ player }: { player: Player }) {
  const { t } = useT();
  const w = player.rank?.wins;
  const l = player.rank?.losses;
  if (w == null || l == null || w + l === 0) return <span className="text-meta text-muted-foreground">—</span>;
  const pct = Math.round((w / (w + l)) * 100);
  return (
    <span title={t("row.record", { w, l })} className={cn("text-meta tabular-nums", pct >= 50 ? "text-success" : "text-muted-foreground")}>
      {pct}%
    </span>
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
// there is no Riot ID. Hovering it opens the Riot ID card; a tap opens it where there is no hover.
function PlayerName({ player, stacked, typeAt }: { player: Player; stacked: boolean; typeAt?: number }) {
  const { t } = useT();
  const touch = useIsTouch();
  const required = useQueue((v) => v.settings.require_riot_id);
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const now = useNow();
  const [game, tag] = player.riot_id ? player.riot_id.split("#") : [player.kick_username, null];
  const name = (
    <span className={cn("flex min-w-0", stacked ? "flex-col" : "items-baseline gap-1")}>
      <span className="truncate text-name">
        {typeAt === undefined ? game : <Typewriter text={game} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={typeAt} />}
      </span>
      {tag && (
        <span
          style={typeAt === undefined ? undefined : { animationDelay: `${typeAt + [...game].length * REVEAL.speed}ms` }}
          className={cn("truncate font-mono text-caption tracking-normal normal-case text-muted-foreground", typeAt !== undefined && "animate-enter")}
        >
          #{tag}
        </span>
      )}
    </span>
  );
  if (!player.riot_id && !required) return name;

  const card = (
    <div className="flex flex-col gap-2">
      {player.riot_id ? (
        <span className="font-mono text-code select-all">{player.riot_id}</span>
      ) : (
        <span className="text-meta text-muted-foreground">{t("card.no_riot")}</span>
      )}
      <span className="text-meta text-muted-foreground">{player.kick_username}</span>
      <RankText player={player} />
      {player.rank?.level != null && <span className="text-meta text-muted-foreground">{t("row.level", { n: player.rank.level })}</span>}
      <span className="text-meta text-muted-foreground">
        {t(player.source === "chat" ? "card.joined_chat" : "card.joined_manual", { t: now ? ago(player.joined_at, now, t) : "" })}
      </span>
      {fairPlay && <span className="text-meta text-muted-foreground">{t("card.games", { n: player.games_played })}</span>}
      {player.riot_id && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => navigator.clipboard.writeText(player.riot_id!).then(() => toast(t("common.copied")))}
        >
          {t("common.copy")}
        </Button>
      )}
    </div>
  );
  const trigger = (
    <button type="button" tabIndex={-1} className="min-w-0 text-left outline-none">
      {name}
    </button>
  );
  if (touch) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-64 rounded-xl p-4">{card}</PopoverContent>
      </Popover>
    );
  }
  return (
    <HoverCard openDelay={350} closeDelay={100}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-64 rounded-xl p-4">{card}</HoverCardContent>
    </HoverCard>
  );
}

// Hover quick actions (August): team 1, team 2, remove. Hidden until the row is hovered or has
// focus inside, but always in the layout, so nothing shifts; absent where there is no hover.
function QuickActions({ player }: { player: Player }) {
  const { t } = useT();
  const a = usePlayerActions(player);
  const canWrite = useCanWrite();
  const touch = useIsTouch();
  if (touch) return null;
  const btn = "size-8 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100";
  const tone = (n: 1 | 2) => (n === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2");
  // In a team (owner, 2026-09-27): swap to the other team and back to waiting, not "add to" a
  // team they are already in; waiting or away: add to either team.
  const moves: { label: string; icon: LucideIcon; tone: string; run: () => unknown }[] = player.team
    ? [
        { label: t("menu.move_to", { team: t(`team.${player.team === 1 ? 2 : 1}`) }), icon: ArrowLeftRight, tone: tone(player.team === 1 ? 2 : 1), run: () => a.moveTo(player.team === 1 ? 2 : 1) },
        { label: t("menu.to_waiting"), icon: Undo2, tone: "text-muted-foreground", run: a.toWaiting },
      ]
    : ([1, 2] as const).map((n) => ({ label: t("menu.move_to", { team: t(`team.${n}`) }), icon: UserPlus, tone: tone(n), run: () => a.moveTo(n) }));
  moves.push({ label: t("menu.remove"), icon: X, tone: "text-muted-foreground", run: a.remove });
  return (
    <span className="flex items-center max-md:hidden">
      {moves.map(({ label, icon: Icon, tone, run }) => (
        <Button
          key={label}
          variant="ghost"
          size="icon"
          className={cn(btn, tone)}
          disabled={!canWrite}
          aria-label={label}
          title={label}
          onClick={() => void run()}
        >
          <Icon aria-hidden />
        </Button>
      ))}
    </span>
  );
}

// Drag and drop (August's sortable queue and rosters), native: a row drags onto another row to
// take its place, or onto the other team's card to change team. Where there is no hover there
// is no drag; the menu and the row keys do the same.
let dragging: Player | null = null;
export const draggedPlayer = () => dragging;

export function useMoveTo() {
  const { t } = useT();
  const act = useAct();
  return (p: Player, team: 1 | 2) =>
    act("move_player", { p_player: p.id, p_status: "playing", p_team: team }, {
      optimistic: { ids: [p.id], patch: (x) => ({ ...x, status: "playing", team }) },
      done: "done.move_team",
      vars: { name: p.kick_username, team: t(`team.${team}`) },
    });
}

// Whether dropping d on that side of row puts it back in its own slot (the rows as drawn).
function inPlace(row: HTMLElement, d: Player, at: "before" | "after") {
  const rows = Array.from(row.closest("[data-rows]")?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
  const i = rows.indexOf(row);
  return rows[at === "before" ? i - 1 : i + 1]?.dataset.player === d.id;
}

// The new place is the midpoint between the target and its neighbour on that side.
function useReorder() {
  const act = useAct();
  const store = useStore();
  return (d: Player, target: Player, at: "before" | "after") => {
    const list = store.get().players.filter((p) => p.id !== d.id);
    const i = list.findIndex((p) => p.id === target.id);
    const nb = list[at === "before" ? i - 1 : i + 1];
    const key = nb ? (target.sort_key + nb.sort_key) / 2 : target.sort_key + (at === "before" ? -1 : 1);
    return act("reorder_player", { p_player: d.id, p_key: key }, {
      optimistic: { ids: [d.id], patch: (x) => ({ ...x, sort_key: key }) },
      done: "done.reorder",
      vars: { name: d.kick_username },
    });
  };
}

// The queue table's columns (August): #, player, Kick, rank, win rate, joined, actions. Under
// 768px the row keeps #, player and actions; under 1024px win rate and joined go too. The actions
// column is a fixed 8rem (three quick actions and the menu), so the header row, whose last cell
// is empty, lines up with the rows.
export const TABLE_COLS =
  "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1.6fr)_minmax(0,1fr)_8.5rem_8rem] lg:grid-cols-[2rem_minmax(0,1.6fr)_minmax(0,1fr)_8.5rem_4.5rem_6rem_8rem]";

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
}: {
  player: Player;
  number?: number;
  variant?: "table" | "roster";
  arrivedAt?: number;
  revertedAt?: number;
  enterStyle?: { className?: string; style?: React.CSSProperties };
  /** A fresh draw landing this row: it rises in at this many ms and types its name. */
  landAt?: number;
}) {
  const a = usePlayerActions(player);
  const canWrite = useCanWrite();
  const [menuOpen, setMenuOpen] = useState(false);
  // The arrival fade and the revert highlight play for events after (or just before) this row
  // mounted, so a tab switch does not replay them.
  const [mountedAt] = useState(() => Date.now());
  const recent = (at?: number) => !!at && at > mountedAt - 2000;
  const table = variant === "table";
  const touch = useIsTouch();
  const reorder = useReorder();
  const [dropAt, setDropAt] = useState<"before" | "after" | null>(null);
  const [lifted, setLifted] = useState(false);
  // A roster row takes drops from its own team only; the other team's rows go to the card.
  const accepts = (d: Player | null): d is Player => !!d && d.id !== player.id && (table || (d.status === "playing" && d.team === player.team));

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
        : "border-l-row-edge";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row
          data-player={player.id}
          tabIndex={0}
          onKeyDown={onKeyDown}
          draggable={canWrite && !touch}
          onDragStart={(e) => {
            dragging = player;
            setLifted(true);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", player.kick_username);
            // The browser would drag a picture of the whole row: a name chip with the row's edge
            // follows the cursor instead (owner, 2026-09-27; the Stage 7 design refines it, D25).
            const chip = document.createElement("div");
            chip.textContent = player.riot_id?.split("#")[0] ?? player.kick_username;
            chip.className = cn(
              "fixed -top-96 left-0 max-w-64 truncate rounded-lg border border-l-[3px] border-row-edge bg-card px-3 py-1.5 text-name text-foreground",
              edge,
            );
            document.body.append(chip);
            e.dataTransfer.setDragImage(chip, 16, chip.offsetHeight / 2);
            requestAnimationFrame(() => chip.remove());
          }}
          onDragEnd={() => {
            dragging = null;
            setLifted(false);
          }}
          onDragOver={(e) => {
            if (!accepts(dragging)) return;
            e.preventDefault();
            e.stopPropagation();
            // Say "move" outright: left to guess, Chrome can treat the drop as refused and fly the
            // ghost back to where it started before the row moves.
            e.dataTransfer.dropEffect = "move";
            const r = e.currentTarget.getBoundingClientRect();
            const at = e.clientY < r.top + r.height / 2 ? "before" : "after";
            // Beside its own row the drop would leave it where it is: refused, with no line.
            if (inPlace(e.currentTarget, dragging, at)) {
              e.dataTransfer.dropEffect = "none";
              return setDropAt(null);
            }
            setDropAt(at);
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(e) => {
            const d = dragging;
            const at = dropAt;
            setDropAt(null);
            if (!accepts(d) || !at) return;
            e.preventDefault();
            e.stopPropagation();
            void reorder(d, player, at);
          }}
          style={enterStyle?.style}
          className={cn(
            "group/row grid items-center gap-x-3 rounded-xl border border-l-[3px] border-row-edge px-4 py-3 outline-none",
            "transition-colors duration-150 ease-out hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            table ? cn("bg-row", TABLE_COLS) : "grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] bg-background",
            edge,
            recent(arrivedAt) && "animate-arrive",
            recent(revertedAt) && "animate-highlight",
            // The grab hand at rest, grabbing while pressed (owner, 2026-09-27, reverting cb06f3a).
            // Once the drag starts the browser draws its own cursor; CSS cannot reach it.
            canWrite && !touch && "cursor-grab active:cursor-grabbing",
            // The row picked up dims at once, so the drag reads as started with no pause.
            lifted && "opacity-40",
            dropAt === "before" && "shadow-[0_-3px_0_0_var(--ring)]",
            dropAt === "after" && "shadow-[0_3px_0_0_var(--ring)]",
            enterStyle?.className,
          )}
        >
          <span className="font-serif text-numeral text-muted-foreground tabular-nums select-none">{number}</span>
          <div className="flex min-w-0 items-center gap-3">
            <PlayerAvatar player={player} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <PlayerName player={player} stacked={table} typeAt={landAt} />
              {table && <RespectBadge player={player} />}
              <PlayerTags player={player} showState={table} />
            </div>
          </div>
          {table && <span className="truncate text-meta text-muted-foreground max-md:hidden">{player.kick_username}</span>}
          {/* Always a cell, so rows with and without a rank keep the next columns in place. */}
          <span className={table ? "max-md:hidden" : "max-sm:hidden"}>
            <RankText player={player} />
          </span>
          {table && (
            <span className="max-lg:hidden">
              <WinRate player={player} />
            </span>
          )}
          {table && (
            <span className="max-lg:hidden">
              <Joined player={player} />
            </span>
          )}
          <span className="flex items-center justify-end">
            {table && <QuickActions player={player} />}
            <RowMenu player={player} kit="dropdown" open={menuOpen} onOpenChange={setMenuOpen} />
          </span>
        </div>
      </ContextMenuTrigger>
      <RowMenu player={player} kit="context" />
    </ContextMenu>
  );
}

// The table's header row, on the same grid as the rows.
export function TableHeader() {
  const { t } = useT();
  const th = "text-caption text-muted-foreground uppercase select-none";
  return (
    <div aria-hidden className={cn("grid items-center gap-x-3 border border-l-[3px] border-transparent px-4 max-md:hidden", TABLE_COLS)}>
      <span className={th}>#</span>
      <span className={th}>{t("col.player")}</span>
      <span className={th}>{t("col.kick")}</span>
      <span className={th}>{t("col.rank")}</span>
      <span className={cn(th, "max-lg:hidden")}>{t("col.winrate")}</span>
      <span className={cn(th, "max-lg:hidden")}>{t("col.joined")}</span>
      <span />
    </div>
  );
}
