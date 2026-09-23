"use client";
import { createContext, useContext } from "react";

import type { Tab } from "@/components/queue/tabs";
import type { Player } from "@/types/queue";

export type SanctionDraft = { name: string; kind: "warn" | "punish" | "ban" };

export type Ui = {
  tab: Tab;
  setTab: (t: Tab) => void;
  palette: boolean;
  setPalette: (open: boolean) => void;
  adding: boolean;
  setAdding: (open: boolean) => void;
  // Add player straight into a team (a team card's Add); null adds to waiting.
  addTo: 1 | 2 | null;
  setAddTo: (team: 1 | 2 | null) => void;
  editing: Player | null;
  setEditing: (p: Player | null) => void;
  sanction: SanctionDraft | null;
  setSanction: (s: SanctionDraft | null) => void;
  focusSearch: () => void;
  // The signed-in Kick account, for the top bar's account menu.
  account: { name: string; image: string | null };
  // True during the first page load only: the entrance never replays (DESIGN.md § Motion).
  entering: boolean;
};

export const UiContext = createContext<Ui | null>(null);

// Kept out of Ui: a ref inside the context object would make every reader "read a ref in render".
export const SearchRefContext = createContext<React.RefObject<HTMLInputElement | null> | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi outside the dashboard");
  return ui;
}

// The entrance: 70ms, then 45ms apart; rows after the chrome, capped at the first 12.
export function enter(entering: boolean, step: number): { className?: string; style?: React.CSSProperties } {
  if (!entering || step > 16) return {};
  return { className: "animate-enter", style: { animationDelay: `${70 + step * 45}ms` } };
}
