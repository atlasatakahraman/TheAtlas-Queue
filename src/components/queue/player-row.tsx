"use client";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

type Item = { label: string; shortcut?: string; onSelect: () => void; destructive?: boolean; swatch?: string; write?: boolean };

function useMenu(p: Player): Item[][] {
  const { t } = useT();
  const a = usePlayerActions(p);
  const groups: Item[][] = [
    [
      ...(p.riot_id ? [{ label: t("menu.copy_riot"), shortcut: "C", onSelect: a.copyRiot }] : []),
      { label: t("menu.copy_name"), onSelect: a.copyName },
    ],
    [{ label: t("menu.edit"), shortcut: "E", onSelect: a.edit, write: true }],
    [
      ...(p.team !== 1 ? [{ label: t("menu.move_to", { team: t("team.1") }), shortcut: "←", onSelect: () => a.moveTo(1), swatch: "bg-team-1", write: true }] : []),
      ...(p.team !== 2 ? [{ label: t("menu.move_to", { team: t("team.2") }), shortcut: "→", onSelect: () => a.moveTo(2), swatch: "bg-team-2", write: true }] : []),
      ...(p.status === "playing" ? [{ label: t("menu.to_waiting"), onSelect: a.toWaiting, write: true }] : []),
      ...(p.status !== "playing"
        ? [{ label: p.status === "away" ? t("menu.back") : t("menu.away"), shortcut: "A", onSelect: a.toggleAway, write: true }]
        : []),
    ],
    p.locked ? [{ label: t("menu.unprotect"), onSelect: a.removeProtection, write: true }] : [],
    [
      { label: t("menu.warn"), shortcut: "W", onSelect: a.warn, write: true },
      { label: t("menu.punish"), onSelect: a.punish, write: true },
      { label: t("menu.ban"), onSelect: a.ban, destructive: true, write: true },
    ],
    [{ label: t("menu.remove"), shortcut: "Del", onSelect: () => void a.remove(), destructive: true, write: true }],
  ];
  return groups.filter((g) => g.length > 0);
}

function RowMenu({ player, kit, open, onOpenChange }: { player: Player; kit: "context" | "dropdown"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const { t } = useT();
  const groups = useMenu(player);
  const canWrite = useCanWrite();
  const K =
    kit === "context"
      ? { Item: ContextMenuItem, Sep: ContextMenuSeparator, Short: ContextMenuShortcut }
      : { Item: DropdownMenuItem, Sep: DropdownMenuSeparator, Short: DropdownMenuShortcut };
  const items = groups.map((g, i) => (
    <div key={i} role="group">
      {i > 0 && <K.Sep />}
      {g.map((it) => (
        <K.Item
          key={it.label}
          variant={it.destructive ? "destructive" : "default"}
          disabled={it.write && !canWrite}
          onSelect={it.onSelect}
        >
          {it.swatch && <span className={cn("size-2.5 rounded-full", it.swatch)} aria-hidden />}
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
  if (kit === "context") return <ContextMenuContent className="min-w-56 p-1.5">{items}</ContextMenuContent>;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("menu.open", { name: player.kick_username })}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 p-1.5">
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Riot ID hover card (DESIGN.md § Recipes): nothing at all when there is no Riot ID and none is
// required; a popover on tap where there is no hover.
function PlayerName({ player }: { player: Player }) {
  const { t } = useT();
  const touch = useIsTouch();
  const required = useQueue((v) => v.settings.require_riot_id);
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const now = useNow();
  const name = <span className="truncate text-name">{player.kick_username}</span>;
  if (!player.riot_id && !required) return name;

  const card = (
    <div className="flex flex-col gap-2">
      {player.riot_id ? (
        <span className="font-mono text-code select-all">{player.riot_id}</span>
      ) : (
        <span className="text-meta text-muted-foreground">{t("card.no_riot")}</span>
      )}
      <RankText player={player} />
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
    <button type="button" tabIndex={-1} className="min-w-0 truncate text-left outline-none">
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

// A player row (DESIGN.md § Recipes → Queue row): number, name, tags, rank, menu. On the floor it
// is bg-row; inside a card (a team roster) it goes back to the floor colour.
export function PlayerRow({
  player,
  number,
  inset = false,
  arrivedAt,
  revertedAt,
  enterStyle,
}: {
  player: Player;
  number?: number;
  inset?: boolean;
  arrivedAt?: number;
  revertedAt?: number;
  enterStyle?: { className?: string; style?: React.CSSProperties };
}) {
  const a = usePlayerActions(player);
  const canWrite = useCanWrite();
  const [menuOpen, setMenuOpen] = useState(false);
  // The arrival fade and the revert highlight play for events after (or just before) this row
  // mounted, so a tab switch does not replay them.
  const [mountedAt] = useState(() => Date.now());
  const recent = (at?: number) => !!at && at > mountedAt - 2000;

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
    if (k === "Enter" || (k === "F10" && e.shiftKey)) {
      setMenuOpen(true);
      return handled();
    }
    const key = k.toLowerCase();
    if (key === "c") return (a.copyRiot(), handled());
    if (!canWrite) return;
    if (key === "e") return (a.edit(), handled());
    if (k === "ArrowLeft") return (void a.moveTo(1), handled());
    if (k === "ArrowRight") return (void a.moveTo(2), handled());
    if (key === "a" && player.status !== "playing") return (void a.toggleAway(), handled());
    if (key === "w") return (a.warn(), handled());
    if (k === "Delete") return (void a.remove(), handled());
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
          tabIndex={0}
          onKeyDown={onKeyDown}
          style={enterStyle?.style}
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-xl border border-l-[3px] border-row-edge px-4 py-3 outline-none",
            "transition-colors duration-150 ease-out hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
            inset ? "bg-background" : "bg-row",
            number === undefined && "grid-cols-[minmax(0,1fr)_auto_auto]",
            edge,
            recent(arrivedAt) && "animate-arrive",
            recent(revertedAt) && "animate-highlight",
            enterStyle?.className,
          )}
        >
          {number !== undefined && (
            <span className="w-7 font-serif text-numeral text-muted-foreground tabular-nums select-none">{number}</span>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <PlayerName player={player} />
            <PlayerTags player={player} />
          </div>
          <RankText player={player} className="max-sm:hidden" />
          <RowMenu player={player} kit="dropdown" open={menuOpen} onOpenChange={setMenuOpen} />
        </div>
      </ContextMenuTrigger>
      <RowMenu player={player} kit="context" />
    </ContextMenu>
  );
}
