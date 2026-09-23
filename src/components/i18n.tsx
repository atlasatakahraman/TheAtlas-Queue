"use client";
import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, translate, type LabelKey, type Labels, type Lang, type Vars } from "@/lib/i18n";

type I18n = { lang: Lang; labels?: Labels; t: (key: LabelKey, vars?: Vars) => string };

const Ctx = createContext<I18n>({ lang: "en", t: (key, vars) => translate("en", key, undefined, vars) });

// The root layout provides the language; the dashboard nests one more with the channel's labels.
export function I18nProvider({ lang, labels, children }: { lang?: Lang; labels?: Labels; children: React.ReactNode }) {
  const parent = useContext(Ctx);
  const l = lang ?? parent.lang;
  const value = useMemo<I18n>(
    () => ({ lang: l, labels, t: (key, vars) => translate(l, key, labels, vars) }),
    [l, labels],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}

// The EN | TR switch: remembered in a cookie so the server renders the next page in it.
export function useSetLang() {
  const router = useRouter();
  return useCallback(
    (lang: Lang) => {
      document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = lang;
      router.refresh();
    },
    [router],
  );
}
