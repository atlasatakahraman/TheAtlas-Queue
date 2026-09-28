"use client";
import { Ellipsis, LogOut, Search, Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { Fragment, useEffect, useState } from "react";
import { useSetLang, useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { ConnectionPill } from "@/components/queue/connection-pill";
import { useQueue } from "@/components/queue/store";
import { useUi } from "@/components/queue/ui";
import { useMedia } from "@/components/use-client-state";
import { Tip } from "@/components/tip";
import { ThemeButton } from "@/components/theme-button";
import { Typed, usePrefs } from "@/components/prefs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const SOURCE_URL = "https://github.com/atlasatakahraman/TheAtlas-Queue";

export const signOutNow = () => void signOut({ redirectTo: "/" });

// GitHub's mark (lucide 1.x ships no brand icons); the path August's header used.
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-4">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function AccountMenu() {
  const { t } = useT();
  const ui = useUi();
  const role = useQueue((v) => v.role);
  const prefs = usePrefs();
  const { name, image } = ui.account;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 rounded-full px-1.5 xl:pr-3 max-md:size-11" aria-label={t("account.menu")}>
          <Avatar className="size-7">
            {image && <AvatarImage src={image} alt="" />}
            <AvatarFallback className="text-caption uppercase">{name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="max-w-32 truncate text-control max-xl:hidden">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 p-1.5">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{name}</DropdownMenuLabel>
        {role === "owner" && (
          <DropdownMenuItem onSelect={() => ui.setTab("settings")}>
            <Settings aria-hidden />
            {t("tab.settings")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* This browser's preferences; the menu stays open while they are flipped. */}
        <DropdownMenuCheckboxItem
          checked={prefs.motion}
          disabled={prefs.motionLocked}
          onCheckedChange={prefs.setMotion}
          onSelect={(e) => e.preventDefault()}
          className="flex-col items-start gap-0"
        >
          {t("prefs.motion")}
          {prefs.motionLocked && <span className="text-meta text-muted-foreground">{t("prefs.motion.locked")}</span>}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.toasts} onCheckedChange={prefs.setToasts} onSelect={(e) => e.preventDefault()}>
          {t("prefs.toasts")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOutNow}>
          <LogOut aria-hidden />
          {t("account.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The top bar (August's header): the TheAtlas tile and wordmark; right, the connection pill,
// search, EN | TR, GitHub, theme, settings and the account. Under 1024px the middle tools fold
// into ⋯ and the pill, ⋯ and the account stay.
// Module state: kept across client navigation, fresh on a reload (and never set on the server).
let wordmarkTyped = false;

export function TopBar() {
  const { t, lang } = useT();
  const ui = useUi();
  const role = useQueue((v) => v.role);
  const channel = useQueue((v) => v.channel.display_name);
  const slug = useQueue((v) => v.channel.slug);
  // On phones the channel types first: the wordmark before it is hidden there.
  const phone = useMedia("(max-width: 639px)");
  // The wordmark types once per page load: coming back without a reload (a game's page to the
  // tabs, Back) it stands and only the slash onwards types, from the start (owner, 2026-09-28).
  const [again] = useState(() => wordmarkTyped);
  useEffect(() => {
    wordmarkTyped = true;
  }, []);
  const shift = again ? -15 * 40 : 0;
  const channelAt = phone ? 0 : 17 * 40 + shift;
  // A game's crumbs type on one beat after the channel's last letter.
  const crumbAt = channelAt + ([...channel].length + 2) * 40;
  const crumbs: { text: string; href?: string }[] =
    ui.game !== null
      ? [{ text: t("tab.games"), href: `/c/${slug}?tab=games` }, { text: String(ui.game) }]
      : ui.settings
        ? [{ text: t("tab.settings") }]
        : [];
  const setLang = useSetLang();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-3 select-none">
        {/* The way back to the selection page (D19): the tile, the wordmark and the channel are one
            link to it, which never redirects from there (?pick). Its tooltip hangs from the tile:
            centred on the whole title it sat under the slash, pointing at nothing (owner,
            2026-09-28); Radix drops the arrow when it cannot point at the middle. */}
        <Tip label={t("select.back")} align="start">
          <Link href="/?pick" className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            {/* The black tile on paper, the white one on ink. */}
            <Image src="/TheAtlasB2048.png" alt="" width={36} height={36} priority className="size-9 rounded-lg dark:hidden" />
            <Image src="/TheAtlasW2048.png" alt="" width={36} height={36} priority className="hidden size-9 rounded-lg dark:block" />
            {/* The page's title now (owner, 2026-09-23): typed in, Queue one 40ms beat after TheAtlas,
                then the slash and the channel, one line typed left to right (owner, 2026-09-27). */}
            {/* On phones the tile alone. The wordmark never truncates; under 1280px the whole title
                steps down to the body size so the channel after it fits (owner, 2026-09-28). */}
            <span className="shrink-0 whitespace-nowrap cap-center font-serif text-title max-xl:text-body max-sm:hidden">
              {again ? "TheAtlas" : <Typed text="TheAtlas" />}{" "}
              <span className="text-brand italic selection:bg-foreground selection:text-background">
                {again ? "Queue" : <Typed text="Queue" startDelay={9 * 40} />}
              </span>
            </span>
            {/* The channel as a breadcrumb (owner, 2026-09-27, D21: the dateline went); D19 makes it
                the way back to the selection page. On phones it stands in for the wordmark. */}
            <span className="cap-center font-serif text-title text-muted-foreground max-xl:text-body max-sm:hidden" aria-hidden>
              <Typed text="/" startDelay={15 * 40 + shift} />
            </span>
            <span className="min-w-0 truncate cap-center font-serif text-title max-xl:text-body">
              <Typed text={channel} startDelay={channelAt} />
            </span>
          </Link>
        </Tip>
        {/* A game's page goes on: … / channel / Games / 5, Games leading back to the tab;
            Settings: … / channel / Settings. */}
        {crumbs.length > 0 && (
          <span className="flex shrink-0 items-baseline gap-3 cap-center font-serif text-title text-muted-foreground max-xl:text-body">
            {crumbs.map((c, i) => {
              const at = crumbAt + crumbs.slice(0, i).reduce((n, x) => n + [...x.text].length + 3, 0) * 40;
              return (
                <Fragment key={c.text}>
                  <span aria-hidden>
                    <Typed text="/" startDelay={at} />
                  </span>
                  {c.href ? (
                    <Link href={c.href} className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
                      <Typed text={c.text} startDelay={at + 2 * 40} />
                    </Link>
                  ) : (
                    <span className="text-foreground tabular-nums">
                      <Typed text={c.text} startDelay={at + 2 * 40} />
                    </span>
                  )}
                </Fragment>
              );
            })}
          </span>
        )}
        {role === "mod" && <span className="shrink-0 text-meta text-muted-foreground max-sm:hidden">{t("masthead.moderating")}</span>}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <ConnectionPill />
        <div className="flex items-center gap-1 max-lg:hidden">
          <Tip label={t("palette.open")}>
            <Button variant="ghost" size="icon-lg" aria-label={t("palette.open")} onClick={() => ui.setPalette(true)}>
              <Search aria-hidden />
            </Button>
          </Tip>
          <LangSwitch />
          <Tip label={t("header.github")}>
            <Button variant="ghost" size="icon-lg" asChild>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label={t("header.github")}>
                <GitHubMark />
              </a>
            </Button>
          </Tip>
          <ThemeButton />
          {role === "owner" && (
            <Tip label={t("tab.settings")}>
              <Button variant="ghost" size="icon-lg" aria-label={t("tab.settings")} onClick={() => ui.setTab("settings")}>
                <Settings aria-hidden />
              </Button>
            </Tip>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" className="size-11 md:size-9 lg:hidden" aria-label={t("masthead.more")}>
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
            <DropdownMenuItem asChild>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                {t("header.github")}
              </a>
            </DropdownMenuItem>
            {role === "owner" && (
              <DropdownMenuItem onSelect={() => ui.setTab("settings")}>{t("tab.settings")}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <AccountMenu />
      </div>
    </div>
  );
}
