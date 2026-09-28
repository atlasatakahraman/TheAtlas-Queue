"use client";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { StatusPage } from "@/components/status-page";
import { ErrorRow } from "@/components/error-row";

// A failed load or a crash (DESIGN.md § Not found and errors): the top bar with the channel from
// the URL, the error row where the tab would be. Nothing is lost: the queue is in Postgres, and a
// reload refetches get_state.
export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const { t } = useT();
  const { slug } = useParams<{ slug: string }>();
  useEffect(() => console.error(error), [error]);
  return (
    <StatusPage crumb={slug}>
      <ErrorRow digest={error.digest} retry={unstable_retry} title={t("error.load")} />
    </StatusPage>
  );
}
