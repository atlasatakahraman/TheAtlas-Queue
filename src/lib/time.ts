import type { LabelKey, Vars } from "@/lib/i18n";

type T = (key: LabelKey, vars?: Vars) => string;

// "12 s", "14 min", "3 h", "2 d": the pill, the feed and the hover card.
export function span(ms: number, t: T): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("time.s", { n: s });
  if (s < 3600) return t("time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.h", { n: Math.floor(s / 3600) });
  return t("time.d", { n: Math.floor(s / 86400) });
}

export function ago(iso: string, now: number, t: T): string {
  return t("time.ago", { t: span(now - Date.parse(iso), t) });
}
