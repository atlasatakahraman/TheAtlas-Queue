"use client";
import { createContext, useContext, useMemo, useState } from "react";
import { LANG_COOKIE, translate, type LabelKey, type Labels, type Lang, type Vars } from "@/lib/i18n";

type I18n = { lang: Lang; labels?: Labels; t: (key: LabelKey, vars?: Vars) => string; setLang: (lang: Lang) => void };

const Ctx = createContext<I18n>({ lang: "en", t: (key, vars) => translate("en", key, undefined, vars), setLang: () => {} });

// The root layout provides the language; the dashboard nests one more with the channel's labels.
// Both dictionaries ship to the browser, so the switch is React state (D17): instant, no server
// round trip. The cookie only picks the language of the next server render.
export function I18nProvider({ lang, labels, children }: { lang?: Lang; labels?: Labels; children: React.ReactNode }) {
  const parent = useContext(Ctx);
  const [own, setOwn] = useState(lang);
  const l = own ?? parent.lang;
  const value = useMemo<I18n>(() => {
    const setLang = own
      ? (next: Lang) => {
          document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          document.documentElement.lang = next;
          setOwn(next);
        }
      : parent.setLang;
    return { lang: l, labels, t: (key, vars) => translate(l, key, labels, vars), setLang };
  }, [l, labels, own, parent.setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}

// The EN | TR switch.
export function useSetLang() {
  return useContext(Ctx).setLang;
}
