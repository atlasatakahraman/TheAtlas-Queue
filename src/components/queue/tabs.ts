import type { LabelKey } from "@/lib/i18n";

// Shared by the server page and the client dashboard (a "use client" module exports only
// references to the server, never values).
export const TABS = ["queue", "teams", "moderation", "history", "games", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_COOKIE = "queue.tab";
// The place last left, /c/<slug> or /watch/<slug>: the selection page's Continue (D19, ADR 0037).
// With AUTO_COOKIE set, / opens it on the server, so nothing flashes first.
export const CONTINUE_COOKIE = "queue.continue";
export const AUTO_COOKIE = "queue.auto";
export const CONTINUE_PATH = /^\/(c|watch)\/([a-z0-9_-]{1,40})$/;
export const rememberPlace = (path: string) => {
  document.cookie = `${CONTINUE_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=31536000; samesite=lax`;
};

// The channels this browser watched, newest first, for the selection page's suggestions.
export const WATCHED = "queue.watched";
export function watchedChannels(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function rememberWatched(slug: string) {
  try {
    localStorage.setItem(WATCHED, JSON.stringify([slug, ...watchedChannels(localStorage.getItem(WATCHED)).filter((x) => x !== slug)].slice(0, 8)));
  } catch {}
}

// Settings is its own page (D20, D30), a section at a time in the URL: /c/<slug>/settings/<section>.
// "settings" stays a Tab so every way in (gear, menus, palette) keeps calling setTab; it navigates.
// Your data arrives with Stage 16.
export const SETTINGS = ["commands", "joining", "riot", "teams", "games", "perks", "watch", "overlays", "moderators", "labels"] as const;
export type SettingsSection = (typeof SETTINGS)[number];
export const SETTINGS_TITLES = {
  commands: "settings.commands",
  joining: "settings.joining",
  riot: "settings.riot",
  teams: "settings.teams",
  games: "settings.games",
  perks: "settings.perks",
  watch: "settings.watch",
  overlays: "settings.overlays",
  moderators: "settings.mods",
  labels: "settings.labels",
} as const satisfies Record<SettingsSection, LabelKey>;
