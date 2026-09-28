"use client";
import { TriangleAlert } from "lucide-react";
import { useT } from "@/components/i18n";
import { StatusBlock } from "@/components/status-page";
import { Button } from "@/components/ui/button";

// The error block (DESIGN.md § Not found and errors): the queue is safe, Reload and Retry.
export function ErrorRow({ digest, retry, title }: { digest?: string; retry: () => void; title?: string }) {
  const { t } = useT();
  return (
    <StatusBlock
      error
      mark={<TriangleAlert aria-hidden className="size-16 text-warning" />}
      title={title ?? t("error.page.title")}
      hint={t("error.safe")}
      code={digest && t("error.page.code", { digest })}
      actions={
        <>
          <Button size="lg" variant="outline" onClick={() => window.location.reload()}>
            {t("menu.reload")}
          </Button>
          <Button size="lg" onClick={() => retry()}>
            {t("common.retry")}
          </Button>
        </>
      }
    />
  );
}
