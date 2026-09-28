import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Ellipsis } from "lucide-react";
import { cookies } from "next/headers";
import { GP_CARD_HEAD, GP_GRID, GP_HEAD, GP_META, GP_ROW, GP_TITLE, MAIN, SHADE } from "@/components/queue/geometry";
import { Shade, TopBarSkeleton } from "@/components/queue/skeletons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LANG_COOKIE, parseLang, translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// A game's page while it loads (DESIGN.md § A game's page → States), built from the page's own
// classes (geometry.ts) and labels, as the dashboard's skeleton (owner, 2026-09-28, 10.10): the
// links and buttons, the headline and its line, two team cards of five rows.
export default async function GameLoading() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, key, undefined, vars);
  return (
    <div aria-busy className="flex flex-1 flex-col">
      <TopBarSkeleton />
      <div className={MAIN}>
        <div className="flex flex-col gap-6">
          <div className={GP_HEAD}>
            <Button variant="ghost" size="lg" tabIndex={-1} className={cn("-ml-3 max-md:h-11", SHADE)}>
              <ArrowLeft />
              {t("tab.games")}
            </Button>
            <div className="flex items-center gap-1">
              {[ChevronLeft, ChevronRight].map((Icon, i) => (
                <Button key={i} variant="ghost" size="icon-lg" tabIndex={-1} className={SHADE}>
                  <Icon />
                </Button>
              ))}
              <Button variant="outline" size="lg" tabIndex={-1} className={cn("ml-2 max-md:h-11", SHADE)}>
                <Copy />
                {t("games.copy")}
              </Button>
              <Button variant="ghost" size="icon-lg" tabIndex={-1} className={SHADE}>
                <Ellipsis />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Shade className={GP_TITLE}>{t("game.title", { team: t("team.1"), game: t("game.title.game", { n: 10 }) })}</Shade>
            <Shade className={GP_META}>00:00 00 00 00:00 00 min 5 v 5</Shade>
          </div>
          <div className={GP_GRID}>
            {[1, 2].map((team) => (
              <section key={team} className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-card">
                <div className="h-[5px] bg-muted" />
                <div className="flex flex-col gap-3 p-4">
                  <div className={GP_CARD_HEAD}>
                    <Shade>{t(team === 1 ? "team.1" : "team.2")}</Shade>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div key={i} className={GP_ROW}>
                        <Skeleton className="h-5 w-4" />
                        <Skeleton className="h-4 w-32 max-w-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 h-16 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden" />
    </div>
  );
}
