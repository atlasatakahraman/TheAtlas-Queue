import { cookies } from "next/headers";
import { HOME, HOME_FOOTER, HOME_MAIN } from "@/components/queue/geometry";
import { Shade } from "@/components/queue/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";

// While / works out who is signed in (DESIGN.md § Designed ahead → skeletons): the home page's own
// classes (geometry.ts) and words drawn transparent, so every line takes the room it will (owner,
// 2026-09-28, 10.10). In the (home) group, so it never shows on the way into the dashboard.
export default async function HomeLoading() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  return (
    <div aria-busy className={HOME}>
      <div className={HOME_MAIN}>
        <Shade className="font-serif text-display max-md:text-title">TheAtlas Queue</Shade>
        <Shade wrap className="text-body">
          {t("home.tagline")}
        </Shade>
        <div className="flex flex-col gap-2">
          {(["home.point.chat", "home.point.fair", "home.point.safe"] as const).map((k) => (
            <div key={k} className="flex gap-3">
              <Skeleton className="mt-1 size-4 shrink-0" />
              <Shade wrap>{t(k)}</Shade>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-start gap-2">
          <Shade className="flex h-11 items-center rounded-lg px-5 text-sm">{t("home.cta")}</Shade>
          <Shade wrap className="text-meta">
            {t("home.stores")}
          </Shade>
        </div>
      </div>
      <div className={HOME_FOOTER}>
        <Shade>TheAtlas Queue {t("source.link")}</Shade>
        <span className="flex items-center gap-1">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="size-9" />
        </span>
      </div>
    </div>
  );
}
