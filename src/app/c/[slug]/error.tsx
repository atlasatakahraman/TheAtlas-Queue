"use client";
import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";

// A failed load or a crash renders where the content would be, with Retry and Reload (DESIGN.md §
// States → Error). Nothing is lost: the queue is in Postgres, and a reload refetches get_state.
export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const { t } = useT();
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto w-full max-w-[1440px] px-8 py-12 max-md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-card p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p>{t("error.load")}</p>
          <p className="text-meta text-muted-foreground">{t("error.safe")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" variant="outline" className="max-md:h-11" onClick={() => window.location.reload()}>
            {t("menu.reload")}
          </Button>
          <Button size="lg" className="max-md:h-11" onClick={() => unstable_retry()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    </main>
  );
}
