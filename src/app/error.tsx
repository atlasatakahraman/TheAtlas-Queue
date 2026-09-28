"use client";

import { useEffect } from "react";
import { ErrorRow } from "@/components/error-row";
import { StatusPage } from "@/components/status-page";

// A row that needs attention (DESIGN.md § Not found and errors).
export default function Error({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <StatusPage>
      <ErrorRow digest={error.digest} retry={unstable_retry} />
    </StatusPage>
  );
}
