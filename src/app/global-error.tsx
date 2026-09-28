"use client";
import "./globals.css";

// The root layout itself failed, so nothing it provides is here: no labels, no theme, no fonts.
// The same error row as error.tsx (DESIGN.md § Not found and errors), both languages stacked.
// The queue is in Postgres; a reload refetches it and loses nothing.
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-8 pt-[16vh] max-md:px-4">
          <div
            role="alert"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-l-[3px] border-row-edge border-l-warning bg-row px-4 py-4 max-md:grid-cols-1"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="font-medium">Something went wrong / Bir şeyler ters gitti</h1>
              <p className="text-sm text-muted-foreground">Your queue is safe: it is saved on the server. Try again, or reload the page.</p>
              <p className="text-sm text-muted-foreground">Sıran güvende: sunucuda kayıtlı. Tekrar dene ya da sayfayı yenile.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="h-9 rounded-lg border border-input px-4 max-md:h-11 max-md:flex-1" onClick={() => window.location.reload()}>
                Reload / Yenile
              </button>
              <button type="button" className="h-9 rounded-lg bg-primary px-4 text-primary-foreground max-md:h-11 max-md:flex-1" onClick={() => unstable_retry()}>
                Retry / Tekrar dene
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
