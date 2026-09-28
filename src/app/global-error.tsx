"use client";
import { TriangleAlert } from "lucide-react";
import "./globals.css";

// The root layout itself failed, so nothing it provides is here: no labels, no theme, no fonts.
// The same block as error.tsx (DESIGN.md § Not found and errors), both languages stacked.
// The queue is in Postgres; a reload refetches it and loses nothing.
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center px-8 pb-[18vh] text-center max-md:px-4">
          <div role="alert" className="flex w-full flex-col items-center gap-3">
            <TriangleAlert aria-hidden className="mb-3 size-16 text-warning" />
            <h1 className="text-2xl font-medium">Something went wrong / Bir şeyler ters gitti</h1>
            <p className="text-sm text-muted-foreground">Your queue is safe: it is saved on the server. Try again, or reload the page.</p>
            <p className="text-sm text-muted-foreground">Sıran güvende: sunucuda kayıtlı. Tekrar dene ya da sayfayı yenile.</p>
            <div className="mt-4 flex gap-2 max-sm:w-full max-sm:flex-col">
              <button type="button" className="h-9 rounded-lg border border-input px-4 max-sm:h-11" onClick={() => window.location.reload()}>
                Reload / Yenile
              </button>
              <button type="button" className="h-9 rounded-lg bg-primary px-4 text-primary-foreground max-sm:h-11" onClick={() => unstable_retry()}>
                Retry / Tekrar dene
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
