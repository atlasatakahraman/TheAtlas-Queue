import "server-only";
import { cookies, headers } from "next/headers";
import { LANG_COOKIE, langFromHeader, parseLang, type Lang } from "@/lib/i18n";

// The production origin every canonical, sitemap and Open Graph URL resolves against
// (DESIGN.md § Metadata and SEO), wherever the page is served from.
export const SITE = "https://theatlas-queue.vercel.app";

// Only production is indexed: a preview or a laptop is a copy (robots.ts).
export const indexable = process.env.VERCEL_ENV === "production";

// The request's language: ?lang (the proxy hands it on as x-lang, so a shared link opens in its
// language), then the cookie, then Accept-Language.
export async function requestLang(): Promise<Lang> {
  const h = await headers();
  return parseLang(h.get("x-lang")) ?? parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? langFromHeader(h.get("accept-language"));
}

// A page's alternates: itself as canonical (with its ?lang, so each language version is its own
// page), and ?lang=en / ?lang=tr with x-default.
export async function alternates(path: string) {
  const q = parseLang((await headers()).get("x-lang"));
  return { canonical: q ? `${path}?lang=${q}` : path, languages: { en: `${path}?lang=en`, tr: `${path}?lang=tr`, "x-default": path } };
}

export const ogLocale = (lang: Lang) => ({ locale: lang === "tr" ? "tr_TR" : "en_US", alternateLocale: lang === "tr" ? "en_US" : "tr_TR" });
