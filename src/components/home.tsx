"use client";
import { MessageSquare, Scale, Server } from "lucide-react";
import { signIn } from "next-auth/react";
import { useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { ThemeButton } from "@/components/theme-button";
import { Typewriter } from "@/components/typewriter";
import { Button } from "@/components/ui/button";

const SOURCE = "https://github.com/atlasatakahraman/TheAtlas-Queue";

// DESIGN.md § Home: the only marketing surface, deliberately small, and the sign-in page.
// Stage 5 adds its metadata, Open Graph image and structured data.
export function Home({ callbackUrl }: { callbackUrl: string }) {
  const { t } = useT();
  // Each point carries its own icon (no bullet dots, owner 2026-09-27).
  const points = [["home.point.chat", MessageSquare], ["home.point.fair", Scale], ["home.point.safe", Server]] as const;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-8 max-md:px-4">
      <main className="flex flex-1 flex-col justify-center gap-8 py-16">
        <h1 className="font-serif text-display max-md:text-title">
          <Typewriter text="TheAtlas" />{" "}
          {/* Queue types on after the name, one 40ms beat for the space. */}
          <span className="text-brand italic selection:bg-foreground selection:text-background">
            <Typewriter text="Queue" startDelay={9 * 40} />
          </span>
        </h1>
        <p className="animate-enter text-body text-foreground" style={{ animationDelay: "70ms" }}>
          {t("home.tagline")}
        </p>
        <ul className="flex flex-col gap-2">
          {points.map(([k, Icon], i) => (
            <li
              key={k}
              className="animate-enter flex gap-3 text-muted-foreground"
              style={{ animationDelay: `${115 + i * 45}ms` }}
            >
              <Icon className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
              {t(k)}
            </li>
          ))}
        </ul>
        <div className="animate-enter flex flex-col items-start gap-2" style={{ animationDelay: "250ms" }}>
          <Button size="lg" className="h-11 px-5" onClick={() => signIn("kick", { callbackUrl })}>
            {t("home.cta")}
          </Button>
          <p className="text-meta text-muted-foreground">{t("home.stores")}</p>
        </div>
      </main>
      <footer className="flex items-center justify-between gap-4 border-t border-border py-4 text-meta text-muted-foreground">
        <span className="flex items-center gap-3">
          TheAtlas Queue
          <a className="underline-offset-4 hover:text-foreground hover:underline" href={SOURCE} rel="noopener">
            {t("source.link")}
          </a>
        </span>
        <span className="flex items-center gap-1">
          <LangSwitch />
          <ThemeButton />
        </span>
      </footer>
    </div>
  );
}
