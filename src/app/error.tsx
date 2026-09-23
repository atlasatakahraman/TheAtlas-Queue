"use client";

import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";

export default function Error({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const { t } = useT();
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="font-serif text-title">{t("error.page.title")}</h1>
      <p className="text-muted-foreground">{t("error.page.hint")}</p>
      {error.digest && (
        <p className="font-mono text-code text-muted-foreground select-all">{t("error.page.code", { digest: error.digest })}</p>
      )}
      <div className="flex gap-2">
        <Button size="lg" onClick={() => unstable_retry()}>
          {t("common.retry")}
        </Button>
        <Button size="lg" variant="outline" onClick={() => window.location.reload()}>
          {t("menu.reload")}
        </Button>
      </div>
    </main>
  );
}
