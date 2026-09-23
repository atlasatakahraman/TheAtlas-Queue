// Shared by the server page and the client dashboard (a "use client" module exports only
// references to the server, never values).
export const TABS = ["queue", "teams", "moderation", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_COOKIE = "queue.tab";
export const LAST_CHANNEL_COOKIE = "queue.last";
