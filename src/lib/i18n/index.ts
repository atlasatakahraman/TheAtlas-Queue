import { en, type LabelKey } from "./en";
import { tr } from "./tr";

export type { LabelKey };
export type Lang = "en" | "tr";
export type Labels = Partial<Record<Lang, Partial<Record<LabelKey, string>>>>;
export type Vars = Record<string, string | number>;

const DICT: Record<Lang, Record<LabelKey, string>> = { en, tr };

export const LANG_COOKIE = "lang";

// The labels a streamer may override. Must equal private.labels_valid (0001_core.sql).
export const CURATED_KEYS = [
  "brand.subtitle", "team.1", "team.2", "match.vs",
  "queue.title", "queue.empty.title", "queue.empty.hint",
  "action.add", "action.draw", "action.reroll", "action.pick",
  "watch.title", "watch.subtitle", "watch.disabled",
  "overlay.queue.title", "overlay.draw.title",
  "chat.joined", "chat.rejected.banned", "chat.rejected.duplicate", "chat.position", "chat.perk", "chat.watch", "chat.joined.many", "chat.rules",
] as const satisfies readonly LabelKey[];

export function parseLang(v: string | null | undefined): Lang | null {
  return v === "en" || v === "tr" ? v : null;
}

// Accept-Language → tr for Turkish, en for anything else (DESIGN.md § Language and labels).
export function langFromHeader(h: string | null): Lang {
  return /^\s*tr\b/i.test(h ?? "") ? "tr" : "en";
}

export function isLabelKey(k: string): k is LabelKey {
  return k in en;
}

// Streamer override for that language → built-in for that language → built-in English.
// An empty override falls back.
export function translate(lang: Lang, key: LabelKey, labels?: Labels, vars?: Vars): string {
  const s = labels?.[lang]?.[key] || DICT[lang][key] || en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
