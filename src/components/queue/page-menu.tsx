"use client";
import { Dices, ListOrdered, Moon, RotateCw, Search, Sun, Swords, Trash2, UserPlus } from "lucide-react";
import { useTheme } from "next-themes";
import { useT } from "@/components/i18n";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { useDrawActions } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
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
// skips a trigger whose event was already handled); text fields and anything portalled out of
// this area keep the browser's menu.
export function PageMenu({ children }: { children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex flex-1 flex-col"
          onContextMenuCapture={(e) => {
            const el = e.target as HTMLElement;
            if (!e.currentTarget.contains(el) || el.closest(TEXT)) e.stopPropagation();
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

  // Kept short on purpose (owner, 2026-09-23): the everyday actions only. Reroll, shuffle, clear
  // teams, reconnect, settings, language and sign-out live in the toolbar, the top bar and the
  // account menu.
  return (
    <ContextMenuContent className="min-w-60 p-1.5">
      <ContextMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
        <ListOrdered className="size-4" aria-hidden />
        {t("menu.page.title", { n: players.length })}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={() => window.location.reload()}>
        <RotateCw aria-hidden />
        {t("menu.reload")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canWrite} onSelect={() => ui.setAdding(true)}>
        <UserPlus aria-hidden />
        {t("action.add")}
      </ContextMenuItem>
      <ContextMenuItem disabled={!canWrite} onSelect={() => void draw()}>
        <Swords aria-hidden />
        {t("action.draw")}
        <Keys>D</Keys>
      </ContextMenuItem>
      <ContextMenuItem disabled={!canWrite} onSelect={() => void pick(1)}>
        <Dices aria-hidden />
        {t("action.pick.n", { n: 1 })}
        <Keys>1</Keys>
      </ContextMenuItem>
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
    </ContextMenuContent>
  );
}
