"use client";
import { useSetLang, useT } from "@/components/i18n";
import { cn } from "@/lib/utils";
import type { Lang } from "@/lib/i18n";

// EN | TR. `onPick` replaces the cookie switch where the URL carries the language (home, /watch).
export function LangSwitch({ onPick }: { onPick?: (l: Lang) => void }) {
  const { lang, t } = useT();
  const setLang = useSetLang();
  return (
    <div role="group" aria-label={t("lang.switch")} className="flex items-center rounded-lg text-control select-none">
      {(["en", "tr"] as const).map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className="px-0.5 text-muted-foreground" aria-hidden>|</span>}
          <button
            type="button"
            aria-pressed={lang === l}
            lang={l}
            onClick={() => (onPick ?? setLang)(l)}
            className={cn(
              "h-9 rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11",
              lang === l ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`lang.${l}`)}
          </button>
        </span>
      ))}
    </div>
  );
}
