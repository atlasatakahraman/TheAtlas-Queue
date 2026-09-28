import { ArrowLeft } from "lucide-react";
import { cookies } from "next/headers";
import { MAIN, SECTION, SECTION_CARD, SETTINGS_GRID, SETTINGS_ITEM, SETTINGS_LIST, SHADE } from "@/components/queue/geometry";
import { Shade, TopBarSkeleton } from "@/components/queue/skeletons";
import { SETTINGS, SETTINGS_TITLES } from "@/components/queue/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LANG_COOKIE, type LabelKey, parseLang, translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// While the Settings page loads (DESIGN.md § Designed ahead: skeletons are the page being
// opened): the top bar, ← Queue, the section list and the first section's card of fields, from
// the page's own classes and labels. Phones: the list, which is the page there.
export default async function SettingsLoading() {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? "en";
  const t = (key: LabelKey) => translate(lang, key);
  return (
    <div aria-busy className="flex flex-1 flex-col">
      <TopBarSkeleton />
      <div className={MAIN}>
        <div className="flex flex-col gap-6">
          <Button aria-hidden variant="ghost" size="lg" tabIndex={-1} className={cn("-ml-3 w-fit max-md:h-11", SHADE)}>
            <ArrowLeft />
            {t("tab.queue")}
          </Button>
          <div className={SETTINGS_GRID}>
            <div className={SETTINGS_LIST}>
              {SETTINGS.map((s) => (
                <span key={s} className={SETTINGS_ITEM}>
                  <Skeleton className="size-4.5 shrink-0" />
                  <Shade>{t(SETTINGS_TITLES[s])}</Shade>
                </span>
              ))}
            </div>
            <div className={cn(SECTION, "max-lg:hidden")}>
              <Shade className="font-serif text-team">{t("settings.commands")}</Shade>
              <div className={SECTION_CARD}>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <Shade className="text-sm">&nbsp;</Shade>
                      <Skeleton className="h-9 w-full max-md:h-11" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 h-16 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden" />
    </div>
  );
}
