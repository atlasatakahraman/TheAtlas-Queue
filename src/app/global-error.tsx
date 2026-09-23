"use client";
import "./globals.css";

// The root layout itself failed, so nothing it provides is here: no labels, no theme, no fonts.
// Both languages, plain. The queue is in Postgres; a reload refetches it and loses nothing.
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-3 px-4 py-16">
          <h1 className="text-title">Something went wrong · Bir şeyler ters gitti</h1>
          <p className="text-muted-foreground">
            Your queue is safe: it is saved on the server. Try again, or reload the page.
            <br />
            Sıran güvende: sunucuda kayıtlı. Tekrar dene ya da sayfayı yenile.
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-primary px-4 py-2 text-primary-foreground" onClick={() => unstable_retry()}>
              Retry · Tekrar dene
            </button>
            <button type="button" className="rounded-lg border border-input px-4 py-2" onClick={() => window.location.reload()}>
              Reload · Yenile
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
