"use client";
import { Award, Check, Crown, Gem, Gift, type LucideIcon, Star } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/lib/utils";

// Kick's chat badges, drawn here (not Kick's artwork): one glyph and colour each (D32). The
// player card's Kick badges (D31) use the same table.
export const BADGES = ["subscriber", "vip", "og", "founder", "sub_gifter"] as const;
export type Badge = (typeof BADGES)[number];
export const BADGE_LOOK: Record<Badge, { icon: LucideIcon; tone: string }> = {
  subscriber: { icon: Star, tone: "text-brand" },
  vip: { icon: Gem, tone: "text-badge-vip" },
  og: { icon: Award, tone: "text-badge-og" },
  founder: { icon: Crown, tone: "text-badge-founder" },
  sub_gifter: { icon: Gift, tone: "text-success" },
};

// A tile per badge, a checkbox group (Tab between tiles, Space toggles). Each tile says what its
// holders get as it stands (owner, 2026-09-28); the last selected tile refuses to clear, with the
// reason; the sentence under the tiles says the result live.
export function BadgePicker({ label, value, onChange, effect, result }: {
  label: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  effect: (who: string, on: boolean) => string;
  result: (who: string) => string;
}) {
  const { t, lang } = useT();
  const id = useId();
  const [refused, setRefused] = useState(false);
  const picked = BADGES.filter((b) => value.includes(b));
  const who = new Intl.ListFormat(lang, { type: "conjunction" }).format(picked.map((b) => t(`badge.${b}.plural`)));

  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-control font-medium select-none">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
        {BADGES.map((b) => {
          const on = value.includes(b);
          const { icon: Icon, tone } = BADGE_LOOK[b];
          return (
            <button
              key={b}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-describedby={refused ? `${id}-refused` : undefined}
              onClick={() => {
                if (on && picked.length === 1) return setRefused(true);
                setRefused(false);
                onChange(on ? value.filter((x) => x !== b) : [...value, b]);
              }}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border bg-background px-3.5 py-3 text-left outline-none select-none",
                "transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 max-md:min-h-11",
                on ? "border-brand" : "border-input",
              )}
            >
              <Icon className={cn("size-5", tone)} aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="text-control font-semibold">{t(`badge.${b}`)}</span>
                <span className="text-meta text-muted-foreground">{effect(t(`badge.${b}.plural`), on)}</span>
              </span>
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-md border",
                  on ? "border-brand bg-brand text-background" : "border-input",
                )}
                aria-hidden
              >
                {on && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className={cn("text-meta", refused || picked.length === 0 ? "text-destructive" : "text-muted-foreground")} id={`${id}-refused`}>
        {refused || picked.length === 0 ? t("settings.perk_badges.refused") : result(who)}
      </p>
    </div>
  );
}
