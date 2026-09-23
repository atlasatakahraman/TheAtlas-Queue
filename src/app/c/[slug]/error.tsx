"use client";
import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";

// A failed load renders where the content would be, with Retry (DESIGN.md § States → Error).
export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const { t } = useT();
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto w-full max-w-[1180px] px-8 py-12 max-md:px-4">
      <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-6">
        <p>{t("error.load")}</p>
        <Button size="lg" variant="outline" onClick={() => unstable_retry()}>
          {t("common.retry")}
        </Button>
      </div>
    </main>
  );
}
