"use client";
import { ArrowUpDown, Dices, ListOrdered, Moon, RotateCw, Search, Sun, Swords, Trash2, UserPlus } from "lucide-react";
import { useTheme } from "next-themes";
import { useT } from "@/components/i18n";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { useDrawActions, usePick } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";
import { useRanks } from "@/components/queue/player-row";
import { type SortKey, useQueueSort } from "@/components/queue/sort";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";

function Keys({ children }: { children: string }) {
  return (
    <ContextMenuShortcut className="tracking-normal">
      <Kbd className="border border-row-edge bg-transparent">{children}</Kbd>
    </ContextMenuShortcut>
  );
}

// Mounted only while the menu is open, so reading the platform cannot mismatch the server render.
function PaletteKeys() {
  return <Keys>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</Keys>;
}

const TEXT = "input, textarea, select, [contenteditable=true]";

// Right-click anywhere on the dashboard (August's page menu). Rows keep their own menu (Radix
// skips a trigger whose event was already handled); text fields, links, a click on selected text
// (owner, 2026-09-27: Copy, Open link) and anything portalled out of this area keep the
// browser's menu. Stopping the event here in capture keeps it from the rows' menus too.
export function PageMenu({ children }: { children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex flex-1 flex-col"
          onContextMenuCapture={(e) => {
            const el = e.target as HTMLElement;
            const sel = window.getSelection();
            const onSelection =
              !!sel && !sel.isCollapsed &&
              Array.from(sel.getRangeAt(0).getClientRects()).some(
                (r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
              );
            if (!e.currentTarget.contains(el) || el.closest(TEXT) || el.closest("a[href]") || onSelection) e.stopPropagation();
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <PageMenuContent />
    </ContextMenu>
  );
}

function PageMenuContent() {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const players = useQueue((v) => v.players);
  const { resolvedTheme, setTheme } = useTheme();
  const { draw, pick, clearQueue } = useDrawActions();
  const picking = usePick();
  const ranks = useRanks();
  const sort = useQueueSort(ranks);
  const sortKeys: [SortKey, string][] = [
    ["name", t("col.player")],
    ...(ranks ? ([["rank", t("col.rank")], ["winrate", t("col.winrate")]] as [SortKey, string][]) : []),
    ["joined", t("col.joined")],
  ];

  // Kept short on purpose (owner, 2026-09-23): the everyday actions only. Reroll, shuffle, clear
  // teams, reconnect, settings, language and sign-out live in the toolbar, the top bar and the
  // account menu.
  return (
    <ContextMenuContent className="min-w-60 p-1.5">
      <ContextMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
        <ListOrdered className="size-4" aria-hidden />
        {t("menu.page.title", { n: players.length })}
      </ContextMenuLabel>
      <ContextMenuItem disabled={!canWrite} onSelect={() => ui.setAdding(true)}>
        <UserPlus aria-hidden />
        {t("action.add")}
      </ContextMenuItem>
      {/* Under 768px the table header hides, so sorting lives here (D35). */}
      {ui.tab === "queue" && (
        <div className="md:hidden">
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowUpDown aria-hidden />
              {t("sort.label")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48 p-1.5">
              <ContextMenuCheckboxItem checked={!sort.key} onSelect={sort.reset}>
                {t("sort.queue")}
              </ContextMenuCheckboxItem>
              {sortKeys.map(([k, label]) => (
                <ContextMenuCheckboxItem key={k} checked={sort.key === k} onSelect={() => sort.toggle(k)}>
                  {label}
                  {sort.key === k && <span className="ml-auto text-muted-foreground">{sort.dir === "desc" ? "↓" : "↑"}</span>}
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </div>
      )}
      {/* Adding, drawing and clearing each their own section (owner, 2026-09-28). */}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canWrite} onSelect={() => void draw()}>
        <Swords aria-hidden />
        {t("action.draw")}
        <Keys>D</Keys>
      </ContextMenuItem>
      <ContextMenuItem disabled={!canWrite || picking.pool === 0} onSelect={() => void pick(1, picking.source)}>
        <Dices aria-hidden />
        {t("action.pick.n", { n: 1 })}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!canWrite || players.length === 0} onSelect={() => void clearQueue()}>
        <Trash2 aria-hidden />
        {t("action.clear_queue")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => ui.setPalette(true)}>
        <Search aria-hidden />
        {t("palette.open")}
        <PaletteKeys />
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
        {resolvedTheme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
        {resolvedTheme === "dark" ? t("theme.light") : t("theme.dark")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => window.location.reload()}>
        <RotateCw aria-hidden />
        {t("menu.reload")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
