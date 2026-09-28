import Image from "next/image";
import Link from "next/link";
import { LangSwitch } from "@/components/lang-switch";
import { ThemeButton } from "@/components/theme-button";

// Not found and errors (DESIGN.md § Not found and errors): the big numeral under a slim top bar.
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
      {/* Centred, a little above the middle. */}
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-8 pt-12 pb-[18vh] max-md:px-4">{children}</main>
    </div>
  );
}

// The block: the mark (404, or the warning icon), the title, one hint, the buttons.
export function StatusBlock({ error = false, mark, title, hint, code, actions }: {
  error?: boolean;
  mark: React.ReactNode;
  title: string;
  hint: string;
  code?: string;
  actions: React.ReactNode;
}) {
  return (
    <div role={error ? "alert" : undefined} className="flex w-full animate-enter flex-col items-center gap-3 text-center">
      {/* The figure at display size; an icon mark keeps its own. */}
      <div className={error ? "mb-3" : "mb-3 font-serif text-[clamp(6rem,20vw,11rem)] leading-none tracking-tight tabular-nums select-none"}>{mark}</div>
      <h1 className="font-serif text-title">{title}</h1>
      <p className="text-muted-foreground">{hint}</p>
      {code && <p className="font-mono text-code text-muted-foreground select-all">{code}</p>}
      <div className="mt-4 flex gap-2 max-sm:w-full max-sm:flex-col max-sm:[&>*]:h-11">{actions}</div>
    </div>
  );
}
