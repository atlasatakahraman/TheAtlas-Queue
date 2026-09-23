"use client";
import { Ellipsis, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useSetLang, useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { ConnectionPill } from "@/components/queue/connection-pill";
import { useQueue } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { ThemeButton } from "@/components/theme-button";
import { Typewriter } from "@/components/typewriter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// DESIGN.md § Pages → Dashboard: the channel name typed in, the gold italic Queue, a muted
// dateline; right, the connection pill and the tools. Under 768px the tools fold into ⋯.
export function Masthead() {
  const { t, lang } = useT();
  const ui = useUi();
  const name = useQueue((v) => v.channel.display_name);
  const liveSince = useQueue((v) => v.channel.live_since);
  const role = useQueue((v) => v.role);
  const waiting = useQueue((v) => v.players.filter((p) => p.status === "waiting").length);
  const subtitle = t("brand.subtitle");
  const setLang = useSetLang();
  const { resolvedTheme, setTheme } = useTheme();

  const [e0, e1] = [enter(ui.entering, 0), enter(ui.entering, 1)];
  const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const time = liveSince && new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(liveSince));

  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 font-serif text-display text-foreground max-md:text-title">
          <Typewriter text={name} />{" "}
          {/* Queue types on after the name, one 40ms beat for the space. */}
          <span className="text-brand italic selection:bg-foreground selection:text-background">
            <Typewriter text="Queue" startDelay={([...name].length + 1) * 40} />
          </span>
        </h1>
        <div style={e1.style} className={cn("flex shrink-0 items-center gap-1", e1.className)}>
          <ConnectionPill />
          <div className="flex items-center gap-1 max-md:hidden">
            <Button variant="ghost" size="icon-lg" aria-label={t("palette.open")} onClick={() => ui.setPalette(true)}>
              <Search aria-hidden />
            </Button>
            <LangSwitch />
            <ThemeButton />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="size-11 md:hidden" aria-label={t("masthead.more")}>
                <Ellipsis aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => ui.setPalette(true)}>{t("palette.open")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={lang === "en"} onSelect={() => setLang("en")}>
                {t("lang.name.en")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={lang === "tr"} onSelect={() => setLang("tr")}>
                {t("lang.name.tr")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                {resolvedTheme === "dark" ? t("theme.light") : t("theme.dark")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {role === "mod" && (
        <span className="inline-flex self-start rounded-full border border-muted-foreground/45 px-2 text-caption tracking-normal text-muted-foreground select-none">
          {t("masthead.moderating")}
        </span>
      )}
      {subtitle && <p className="text-body text-muted-foreground">{subtitle}</p>}
      <p style={e0.style} className={cn("text-meta text-muted-foreground", e0.className)}>
        <span suppressHydrationWarning>{day}</span>
        {" · "}
        {time ? t("dateline.live", { time }) : t("dateline.offline")}
        {" · "}
        {t("dateline.waiting", { n: waiting })}
      </p>
    </header>
  );
}
