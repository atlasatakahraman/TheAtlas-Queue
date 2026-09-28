import Image from "next/image";
import Link from "next/link";
import { LangSwitch } from "@/components/lang-switch";
import { ThemeButton } from "@/components/theme-button";
import { cn } from "@/lib/utils";

// Not found and errors (DESIGN.md § Not found and errors): one queue row under a slim top bar.
// No hooks, so the server's not-found page and the client error boundaries share it.

export function StatusPage({ crumb, children }: { crumb?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[3.75rem] w-full max-w-[1440px] items-center justify-between gap-3 px-8 max-md:px-4">
          <span className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex shrink-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <Image src="/TheAtlasB2048.png" alt="" width={36} height={36} className="size-9 rounded-lg dark:hidden" />
              <Image src="/TheAtlasW2048.png" alt="" width={36} height={36} className="hidden size-9 rounded-lg dark:block" />
              <span className="cap-center font-serif text-title max-md:text-body max-sm:hidden">
                TheAtlas <span className="text-brand italic">Queue</span>
              </span>
            </Link>
            {crumb && (
              <>
                <span aria-hidden className="cap-center font-serif text-title text-muted-foreground max-md:text-body max-sm:hidden">
                  /
                </span>
                <span className="min-w-0 truncate cap-center font-serif text-title max-md:text-body">{crumb}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <LangSwitch />
            <ThemeButton />
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col px-8 pt-[16vh] pb-16 max-md:px-4 max-md:pt-12">{children}</main>
    </div>
  );
}

// The row: an empty slot for "missing", a warning-edged row for "error".
export function StatusRow({ kind, mark, title, hint, code, actions }: {
  kind: "missing" | "error";
  mark: React.ReactNode;
  title: string;
  hint: string;
  code?: string;
  actions: React.ReactNode;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className={cn(
        "animate-enter grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-xl border px-4 py-4 max-md:grid-cols-[2.5rem_minmax(0,1fr)]",
        kind === "missing" ? "border-dashed border-row-edge" : "border-l-[3px] border-row-edge border-l-warning bg-row",
      )}
    >
      <span className="font-serif text-numeral text-muted-foreground tabular-nums select-none">{mark}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-name">{title}</h1>
        <p className="text-meta text-muted-foreground">{hint}</p>
        {code && <p className="font-mono text-code text-muted-foreground select-all">{code}</p>}
      </div>
      <div className="flex gap-2 max-md:col-span-2 max-md:grid max-md:auto-cols-fr max-md:grid-flow-col max-md:[&>*]:h-11">{actions}</div>
    </div>
  );
}
