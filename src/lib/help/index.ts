import "server-only";
import type { Lang } from "@/lib/i18n";
import { en } from "./en";
import { tr } from "./tr";

// The help pages (D33, DESIGN.md § Help): one article per topic, English slugs and anchors in
// both languages so Settings can link to either. Server-only: both label dictionaries ship to
// every browser (D17), the help would weigh on every page.
export const TOPICS = [
  "getting-started", "chat-commands", "queue", "teams", "games", "moderation", "perks", "watch", "settings", "keyboard", "privacy",
] as const;
export type Topic = (typeof TOPICS)[number];

// A paragraph is a string with light markup: `a key or command`, **strong**, [a link](/path).
export type Block = string | { list: string[] } | { keys: [string, string][] };
export type Article = { title: string; description: string; lead: string; sections: { id: string; title: string; body: Block[] }[] };
export type Help = Record<Topic, Article> & { ui: { title: string; topics: string; search: string; none: string; onThisPage: string } };

export const HELP: Record<Lang, Help> = { en, tr };

export const isTopic = (t: string | undefined): t is Topic => !!t && (TOPICS as readonly string[]).includes(t);
export const topicPath = (t: Topic) => (t === "getting-started" ? "/wiki" : `/wiki/${t}`);
