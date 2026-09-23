"use client";
import { createContext, useContext } from "react";

import type { Tab } from "@/components/queue/tabs";

export type Ui = {
  tab: Tab;
  setTab: (t: Tab) => void;
  palette: boolean;
  setPalette: (open: boolean) => void;
  adding: boolean;
  setAdding: (open: boolean) => void;
  search: React.RefObject<HTMLInputElement | null>;
  // True during the first page load only: the entrance never replays (DESIGN.md § Motion).
  entering: boolean;
};

export const UiContext = createContext<Ui | null>(null);

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
