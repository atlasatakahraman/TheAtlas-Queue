"use client";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSetLang, useT } from "@/components/i18n";
import { useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { useDrawActions } from "@/components/queue/teams-tab";
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

function Keys({ children }: { children: string }) {
  return (
    <CommandShortcut className="tracking-normal">
      <Kbd className="border border-row-edge bg-transparent">{children}</Kbd>
    </CommandShortcut>
  );
}

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

// ⌘K (DESIGN.md § Recipes → Command palette): Actions, Players, Go to, Preferences. Every
// action shows its shortcut; this and the row menu are the only places they are written down.
export function Palette() {
  const { t, lang } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const role = useQueue((v) => v.role);
  const players = useQueue((v) => v.players);
  const standingTeams = useQueue((v) => v.draw?.kind === "teams");
  const setLang = useSetLang();
  const { resolvedTheme, setTheme } = useTheme();
  const { draw, reroll, pick } = useDrawActions();
  const run = (f: () => void) => () => {
    ui.setPalette(false);
    f();
  };
  const tabs: Tab[] = role === "owner" ? ["queue", "teams", "moderation", "settings"] : ["queue", "teams", "moderation"];

  return (
    <CommandDialog open={ui.palette} onOpenChange={ui.setPalette} title={t("palette.open")} description={t("palette.hint")}>
      {/* This shadcn CommandDialog does not wrap its children in Command; cmdk needs it. */}
      <Command>
        <CommandInput placeholder={t("palette.placeholder")} />
        <CommandList className="max-h-96">
          <CommandEmpty>{t("palette.empty")}</CommandEmpty>
          <CommandGroup heading={t("palette.actions")}>
            <CommandItem disabled={!canWrite} onSelect={run(() => void draw())}>
              {t("action.draw")}
              <Keys>D</Keys>
            </CommandItem>
            <CommandItem disabled={!canWrite || !standingTeams} onSelect={run(() => void reroll())}>
              {t("action.reroll")}
              <Keys>R</Keys>
            </CommandItem>
            {[1, 2, 3, 4, 5].map((n) => (
              <CommandItem key={n} disabled={!canWrite} onSelect={run(() => void pick(n))}>
                {t("action.pick.n", { n })}
                <Keys>{String(n)}</Keys>
              </CommandItem>
            ))}
            <CommandItem disabled={!canWrite} onSelect={run(() => ui.setAdding(true))}>
              {t("action.add")}
            </CommandItem>
          </CommandGroup>
          {players.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("palette.players")}>
                {players.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.kick_username} ${p.riot_id ?? ""}`}
                    onSelect={run(() => {
                      ui.setTab("queue");
                      openRow(p.id);
                    })}
                  >
                    <span className="text-name">{p.kick_username}</span>
                    {p.riot_id && <span className="font-mono text-code text-muted-foreground">{p.riot_id}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandSeparator />
          <CommandGroup heading={t("palette.goto")}>
            {tabs.map((k) => (
              <CommandItem key={k} onSelect={run(() => ui.setTab(k))}>
                {t(`tab.${k}`)}
              </CommandItem>
            ))}
            <CommandItem onSelect={run(() => ui.focusSearch())}>
              {t("queue.search")}
              <Keys>/</Keys>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t("palette.prefs")}>
            <CommandItem onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              {resolvedTheme === "dark" ? t("theme.light") : t("theme.dark")}
            </CommandItem>
            <CommandItem onSelect={run(() => setLang(lang === "en" ? "tr" : "en"))}>
              {lang === "en" ? t("lang.name.tr") : t("lang.name.en")}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

const TYPING = "input, textarea, select, [contenteditable=true], [role=combobox]";

// Global keys (DESIGN.md § Focus and keyboard): only when no text input and no row has focus,
// and nothing modal is open. ⌘K works everywhere.
export function Hotkeys() {
  const ui = useUi();
  const store = useStore();
  const { draw, reroll, pick } = useDrawActions();
  const { setPalette, focusSearch } = ui;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!document.querySelector("[role=dialog]"));
        return;
      }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (el.closest?.(TYPING) || el.closest?.("[data-row]") || document.querySelector("[role=dialog], [role=menu]")) return;
      const v = store.get();
      const writable = v.online && v.conn === "live" && !v.lost;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (!writable) {
        return;
      } else if (key === "d") {
        e.preventDefault();
        void draw();
      } else if (key === "r" && v.draw?.kind === "teams") {
        e.preventDefault();
        void reroll();
      } else if (/^[1-5]$/.test(key)) {
        e.preventDefault();
        void pick(Number(key));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store, draw, reroll, pick, setPalette, focusSearch]);
  return null;
}
