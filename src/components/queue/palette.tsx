"use client";
import {
  ArrowLeft,
  Bell,
  Dices,
  Eraser,
  Hand,
  HistoryIcon,
  Languages,
  ListOrdered,
  ListX,
  LocateFixed,
  LogOut,
  type LucideIcon,
  Moon,
  Search,
  Settings2,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Sun,
  Swords,
  Trophy,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useSetLang, useT } from "@/components/i18n";
import { usePrefs } from "@/components/prefs";
import { PlayerTags, RankText, usePlayerMenu, useRanks, useRiotIds } from "@/components/queue/player-row";
import { useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { signOutNow } from "@/components/queue/header";
import { useDrawActions, usePick } from "@/components/queue/teams-tab";
import type { Tab } from "@/components/queue/tabs";
import { useUi } from "@/components/queue/ui";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { Player } from "@/types/queue";

function Keys({ children }: { children: string }) {
  return (
    <CommandShortcut className="tracking-normal">
      <Kbd className="border border-row-edge bg-transparent">{children}</Kbd>
    </CommandShortcut>
  );
}

const TAB_ICONS: Record<Tab, LucideIcon> = { queue: ListOrdered, teams: Swords, moderation: ShieldAlert, history: HistoryIcon, games: Trophy, settings: Settings2 };

// With nothing typed the palette lists this many players; typing searches them all.
const PLAYERS_AT_REST = 5;

// A player's state as the rows draw it: the team colour in a game, warning when punished.
const edge = (p: Player) =>
  p.status === "playing" ? (p.team === 2 ? "bg-team-2" : "bg-team-1") : p.status === "punished" ? "bg-warning" : "bg-row-edge";

const DESTRUCTIVE = "text-destructive data-selected:text-destructive *:[svg]:text-destructive!";

type Run = (f: () => void) => () => void;

// Opens a player's row menu: the Queue tab, then the row's own Enter key. Waits for the palette
// to finish closing, since a closing dialog returns focus and would dismiss the menu.
export function openRow(id: string) {
  setTimeout(() => {
    const row = document.querySelector<HTMLElement>(`[data-row][data-player="${id}"]`);
    if (!row) return;
    row.focus();
    row.scrollIntoView({ block: "center" });
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, 250);
}

// ⌘K (DESIGN.md § Recipes → Command palette; reworked on the owner's free hand, 2026-09-28):
// Actions, Players, Go to, Preferences, each item with its icon, and a key legend. Choosing a
// player turns the palette into that player: their card, then the row menu's own sections. Esc,
// or Backspace in an empty search, goes back. Every action shows its shortcut; this and the row
// menu are the only places they are written down.
export function Palette() {
  const { t } = useT();
  const ui = useUi();
  const players = useQueue((v) => v.players);
  const [who, setWho] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Each opening starts at the top: reset on close, during render (no effect).
  const [open, setOpen] = useState(ui.palette);
  if (open !== ui.palette) {
    setOpen(ui.palette);
    if (!ui.palette) {
      setWho(null);
      setSearch("");
    }
  }
  const player = who ? players.find((p) => p.id === who) : undefined;
  const go = (id: string | null) => {
    setWho(id);
    setSearch("");
  };
  const run: Run = (f) => () => {
    ui.setPalette(false);
    f();
  };

  return (
    <CommandDialog
      open={ui.palette}
      // Esc on a player's page goes back to everything rather than closing.
      onOpenChange={(o) => (!o && player ? go(null) : ui.setPalette(o))}
      title={t("palette.open")}
      description={t("palette.hint")}
      className="sm:max-w-xl"
    >
      {/* This shadcn CommandDialog does not wrap its children in Command; cmdk needs it. A new
          key per page starts its selection at the top. */}
      <Command
        key={player?.id ?? "root"}
        onKeyDown={(e) => {
          if (player && e.key === "Backspace" && !search) {
            e.preventDefault();
            go(null);
          }
        }}
      >
        {player && <PlayerCard player={player} onBack={() => go(null)} />}
        <CommandInput
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder={player ? t("palette.player.placeholder", { name: player.kick_username }) : t("palette.placeholder")}
        />
        <CommandList className="max-h-[min(24rem,60vh)]">
          <CommandEmpty>{t("palette.empty")}</CommandEmpty>
          {player ? <PlayerCommands player={player} run={run} /> : <RootCommands search={search} run={run} onPlayer={go} />}
        </CommandList>
        {/* The keys, for a keyboard; touch has none. */}
        <footer className="flex items-center gap-4 border-t border-border px-3 pt-2 pb-1 text-meta text-muted-foreground max-md:hidden">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("palette.key.move")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t("palette.key.open")}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            {t(player ? "palette.key.back" : "palette.key.close")}
          </span>
        </footer>
      </Command>
    </CommandDialog>
  );
}

// The palette as one player: the name in the title face beside the row's state edge, the #TAG
// and Kick name under it, their tags and rank on the right, and a way back.
function PlayerCard({ player, onBack }: { player: Player; onBack: () => void }) {
  const { t } = useT();
  const riot = useRiotIds();
  const ranks = useRanks();
  const [game, tag] = riot && player.riot_id ? player.riot_id.split("#") : [player.kick_username, null];
  return (
    <div className="flex items-center gap-3 px-2 pt-2 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("palette.back")}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </button>
      <span className={cn("h-10 w-[3px] shrink-0 rounded-[1px]", edge(player))} aria-hidden />
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-serif text-title">{game}</span>
        {tag && (
          <span className="flex min-w-0 items-baseline gap-2 text-caption text-muted-foreground">
            <span className="font-mono tracking-normal normal-case">#{tag}</span>
            <span className="truncate">{player.kick_username}</span>
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
        <PlayerTags player={player} />
        {ranks && <RankText player={player} />}
      </div>
    </div>
  );
}

// The row menu's sections, each its own group, then Show in the queue.
function PlayerCommands({ player, run }: { player: Player; run: Run }) {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const groups = usePlayerMenu(player);
  return (
    <>
      <CommandGroup>
        <CommandItem
          onSelect={run(() => {
            ui.setTab("queue");
            openRow(player.id);
          })}
        >
          <LocateFixed aria-hidden />
          {t("palette.player.show")}
        </CommandItem>
      </CommandGroup>
      {groups.map((g, i) => (
        <CommandGroup key={i} className="border-t border-border">
          {g.map((it) => (
            <CommandItem
              key={it.label}
              value={it.label}
              disabled={(it.write && !canWrite) || it.disabled}
              onSelect={run(it.onSelect)}
              className={it.destructive ? DESTRUCTIVE : it.tone && cn(it.tone, "data-selected:text-current *:[svg]:text-current!")}
            >
              <it.icon aria-hidden />
              {it.label}
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  );
}

function RootCommands({ search, run, onPlayer }: { search: string; run: Run; onPlayer: (id: string) => void }) {
  const { t, lang } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const role = useQueue((v) => v.role);
  const players = useQueue((v) => v.players);
  const riot = useRiotIds();
  const prefs = usePrefs();
  const standingTeams = useQueue((v) => v.draw?.kind === "teams");
  const setLang = useSetLang();
  const { resolvedTheme, setTheme } = useTheme();
  const { draw, reroll, pick, shuffle, clearTeams, clearQueue } = useDrawActions();
  const picking = usePick();
  const playing = players.filter((p) => p.status === "playing").length;
  const tabs: Tab[] = role === "owner" ? ["queue", "teams", "moderation", "history", "games", "settings"] : ["queue", "teams", "moderation", "history", "games"];
  const shown = search ? players : players.slice(0, PLAYERS_AT_REST);

  return (
    <>
      <CommandGroup heading={t("palette.actions")}>
        <CommandItem disabled={!canWrite} onSelect={run(() => void draw())}>
          <Swords aria-hidden />
          {t("action.draw")}
          <Keys>D</Keys>
        </CommandItem>
        <CommandItem disabled={!canWrite || !standingTeams} onSelect={run(() => void reroll())}>
          <Dices aria-hidden />
          {t("action.reroll")}
        </CommandItem>
        {picking.sizes.map((n) => (
          <CommandItem key={n} disabled={!canWrite || picking.pool === 0} onSelect={run(() => void pick(n, picking.source))}>
            <Hand aria-hidden />
            {t("action.pick.n", { n })}
          </CommandItem>
        ))}
        <CommandItem disabled={!canWrite || playing < 2} onSelect={run(() => void shuffle())}>
          <Shuffle aria-hidden />
          {t("action.shuffle_teams")}
        </CommandItem>
        <CommandItem disabled={!canWrite} onSelect={run(() => ui.setAdding(true))}>
          <UserPlus aria-hidden />
          {t("action.add")}
        </CommandItem>
        <CommandItem disabled={!canWrite || playing === 0} onSelect={run(() => void clearTeams())} className={DESTRUCTIVE}>
          <Eraser aria-hidden />
          {t("action.clear_teams")}
        </CommandItem>
        <CommandItem disabled={!canWrite || players.length === 0} onSelect={run(() => void clearQueue())} className={DESTRUCTIVE}>
          <ListX aria-hidden />
          {t("action.clear_queue")}
        </CommandItem>
      </CommandGroup>
      {shown.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading={t("palette.players")}>
            {/* A player as a small row: the state edge, the name over the Riot ID, the tags. */}
            {shown.map((p) => (
              <CommandItem key={p.id} value={`${p.kick_username} ${p.riot_id ?? ""}`} onSelect={() => onPlayer(p.id)} className="gap-3">
                <span className={cn("h-7 w-[3px] shrink-0 rounded-[1px]", edge(p))} aria-hidden />
                {/* The name grows, not an ml-auto: the item's hidden check icon takes ml-auto too,
                    and the two would split the space. */}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-name">{p.kick_username}</span>
                  {riot && p.riot_id && <span className="truncate font-mono text-code text-muted-foreground">{p.riot_id}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <PlayerTags player={p} />
                </span>
              </CommandItem>
            ))}
            {!search && players.length > shown.length && (
              <p className="px-2 py-1.5 text-meta text-muted-foreground">{t("palette.players.more", { n: players.length - shown.length })}</p>
            )}
          </CommandGroup>
        </>
      )}
      <CommandSeparator />
      <CommandGroup heading={t("palette.goto")}>
        {tabs.map((k, i) => {
          const Icon = TAB_ICONS[k];
          return (
            <CommandItem key={k} onSelect={run(() => ui.setTab(k))}>
              <Icon aria-hidden />
              {t(`tab.${k}`)}
              {i < 5 && <Keys>{String(i + 1)}</Keys>}
            </CommandItem>
          );
        })}
        <CommandItem onSelect={run(() => ui.focusSearch())}>
          <Search aria-hidden />
          {t("queue.search")}
          <Keys>/</Keys>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading={t("palette.prefs")}>
        <CommandItem onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
          {resolvedTheme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {resolvedTheme === "dark" ? t("theme.light") : t("theme.dark")}
        </CommandItem>
        <CommandItem onSelect={run(() => setLang(lang === "en" ? "tr" : "en"))}>
          <Languages aria-hidden />
          {lang === "en" ? t("lang.name.tr") : t("lang.name.en")}
        </CommandItem>
        <CommandItem disabled={prefs.motionLocked} onSelect={() => prefs.setMotion(!prefs.motion)}>
          <Sparkles aria-hidden />
          {t("prefs.motion")}
          <CommandShortcut className="tracking-normal">{t(prefs.motion ? "prefs.on" : "prefs.off")}</CommandShortcut>
        </CommandItem>
        <CommandItem onSelect={() => prefs.setToasts(!prefs.toasts)}>
          <Bell aria-hidden />
          {t("prefs.toasts")}
          <CommandShortcut className="tracking-normal">{t(prefs.toasts ? "prefs.on" : "prefs.off")}</CommandShortcut>
        </CommandItem>
        <CommandItem onSelect={run(signOutNow)}>
          <LogOut aria-hidden />
          {t("account.sign_out")}
        </CommandItem>
      </CommandGroup>
    </>
  );
}

const TYPING = "input, textarea, select, [contenteditable=true], [role=combobox]";

const TAB_KEYS: Tab[] = ["queue", "teams", "moderation", "history", "games"];

// Global keys (DESIGN.md § Focus and keyboard, D18): a narrow set that no browser shortcut uses.
// Only when no text input and no row has focus and nothing modal is open; ⌘K works everywhere,
// Esc lets go of the search box or a row.
export function Hotkeys() {
  const ui = useUi();
  const store = useStore();
  const { draw } = useDrawActions();
  const { setPalette, focusSearch, setTab } = ui;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!document.querySelector("[role=dialog]"));
        return;
      }
      const el = e.target as HTMLElement;
      if (e.key === "Escape" && (el.matches?.("[data-row], input[type=search]")) && !document.querySelector("[role=dialog], [role=menu]")) {
        el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (el.closest?.(TYPING) || el.closest?.("[data-row]") || document.querySelector("[role=dialog], [role=menu]")) return;
      const v = store.get();
      const writable = v.online && v.conn === "live" && !v.lost;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (/^[1-5]$/.test(key)) {
        e.preventDefault();
        setTab(TAB_KEYS[Number(key) - 1]);
      } else if (!writable) {
        return;
      } else if (key === "d") {
        e.preventDefault();
        void draw();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store, draw, setPalette, focusSearch, setTab]);
  return null;
}
