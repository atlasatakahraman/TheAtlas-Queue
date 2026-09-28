"use client";
import { ArrowRight, LogOut, Radio, RadioOff, Shield, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { Typed } from "@/components/prefs";
import { ThemeButton } from "@/components/theme-button";
import { Tag } from "@/components/queue/team-card";
import { AUTO_COOKIE, CONTINUE_COOKIE, WATCHED, watchedChannels } from "@/components/queue/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HOME_FOOTER, SELECT, SELECT_ROW } from "@/components/queue/geometry";

export type Place = { slug: string; name: string; role: "owner" | "mod"; live: boolean; waiting: number; watch: boolean };
// The place last left; name null when it is gone (the channel, or this account's access to it).
export type Resume = { kind: "manage" | "watch"; slug: string; name: string | null; live: boolean; waiting: number | null };

const SOURCE = "https://github.com/atlasatakahraman/TheAtlas-Queue";
const noop = () => () => {};

// A name or a Kick link to a channel slug; null when it is neither.
function toSlug(v: string): string | null {
  const s = v.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?kick\.com\//, "").replace(/[/?#].*$/, "");
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : null;
}

function Initial({ name, image }: { name: string; image?: string | null }) {
  return (
    <Avatar className="size-9 border border-row-edge">
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="bg-transparent text-meta text-muted-foreground uppercase">{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

function Live({ live }: { live: boolean }) {
  const { t } = useT();
  return live ? (
    <Tag tone="success" icon={Radio}>{t("live.on")}</Tag>
  ) : (
    <Tag tone="muted" icon={RadioOff}>{t("live.off")}</Tag>
  );
}

// DESIGN.md § Selection page: / signed in. The home page's wordmark and faces, then Continue,
// your channels and any channel by name. No redirect unless Open this automatically is on (the
// server reads its cookie, so nothing flashes); the dashboards' title leads back here.
export function SelectPage({ account, channels, resume, auto }: {
  account: { name: string; image: string | null };
  channels: Place[];
  resume: Resume | null;
  auto: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [on, setOn] = useState(auto);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const raw = useSyncExternalStore(
    noop,
    () => {
      try {
        return localStorage.getItem(WATCHED);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const recent = useMemo(() => watchedChannels(raw), [raw]);
  const owner = channels.find((c) => c.role === "owner");

  const setAuto = (v: boolean) => {
    setOn(v);
    document.cookie = v ? `${AUTO_COOKIE}=1; path=/; max-age=31536000; samesite=lax` : `${AUTO_COOKIE}=; path=/; max-age=0; samesite=lax`;
  };
  const forget = () => {
    document.cookie = `${CONTINUE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    setAuto(false);
    setGone(true);
  };
  const watch = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = toSlug(name);
    if (!slug) return setInvalid(true);
    router.push(`/watch/${slug}`);
  };
  const place = resume && !gone ? resume : null;
  const href = place && (place.kind === "manage" ? `/c/${place.slug}` : `/watch/${place.slug}`);

  return (
    <div className={SELECT}>
      <header className="flex items-center justify-between gap-4 pt-10 max-md:pt-6">
        <h1 className="font-serif text-display max-md:text-title">
          <Typed text="TheAtlas" />{" "}
          <span className="text-brand italic selection:bg-foreground selection:text-background">
            <Typed text="Queue" startDelay={9 * 40} />
          </span>
        </h1>
        <span className="flex min-w-0 items-center gap-2">
          <Initial name={account.name} image={account.image} />
          <span className="truncate text-control max-sm:hidden">{account.name}</span>
          <Button variant="ghost" size="icon-lg" className="max-md:size-11" aria-label={t("account.sign_out")} onClick={() => void signOut({ redirectTo: "/" })}>
            <LogOut aria-hidden />
          </Button>
        </span>
      </header>

      <main className="flex flex-1 flex-col gap-10 py-10">
        {place && (
          <section className="animate-enter flex flex-col gap-3" style={{ animationDelay: "70ms" }}>
            <h2 className="font-serif text-team">{t("select.continue")}</h2>
            <div className={SELECT_ROW}>
              <Initial name={place.name ?? place.slug} image={place.kind === "manage" && place.slug === owner?.slug ? account.image : null} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-name">{place.name ?? place.slug}</span>
                <span className="text-meta text-muted-foreground">
                  {place.name === null ? t("select.gone") : t(place.kind === "manage" ? "select.manage" : "select.watch")}
                </span>
              </span>
              {place.name !== null && place.waiting !== null && (
                <span className="text-meta text-muted-foreground tabular-nums">{t("select.waiting", { n: place.waiting })}</span>
              )}
              {place.name !== null && <Live live={place.live} />}
              {place.name === null ? (
                <Button variant="outline" size="lg" className="max-md:h-11" onClick={forget}>
                  {t("select.remove")}
                </Button>
              ) : (
                <Button size="lg" className="max-md:h-11" asChild>
                  <Link href={href!}>
                    {t("select.continue")}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              )}
            </div>
            {place.name !== null && (
              <div className="flex items-start gap-3 px-1">
                <Switch id="auto" checked={on} onCheckedChange={setAuto} className="mt-0.5" />
                <Label htmlFor="auto" className="flex cursor-pointer flex-col items-start gap-0.5 leading-normal">
                  <span className="text-control">{t("select.auto")}</span>
                  <span className="text-meta font-normal text-muted-foreground">{t("select.auto.hint")}</span>
                </Label>
              </div>
            )}
          </section>
        )}

        <section className="animate-enter flex flex-col gap-3" style={{ animationDelay: "115ms" }}>
          <h2 className="font-serif text-team">{t("select.channels")}</h2>
          {channels.length === 0 && <p className="text-muted-foreground">{t("select.none")}</p>}
          {channels.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {channels.map((c) => (
                <li key={c.slug} className={SELECT_ROW}>
                  <Initial name={c.name} image={c.role === "owner" ? account.image : null} />
                  <span className="min-w-0 flex-1 truncate text-name">{c.name}</span>
                  <Tag tone={c.role === "owner" ? "brand" : "muted"} icon={c.role === "owner" ? Video : Shield}>
                    {t(`select.role.${c.role}`)}
                  </Tag>
                  <Live live={c.live} />
                  <span className="min-w-[8ch] text-meta text-muted-foreground tabular-nums">{t("select.waiting", { n: c.waiting })}</span>
                  <span className="flex gap-2">
                    {c.watch && (
                      <Button variant="outline" size="lg" className="max-md:h-11" asChild>
                        <Link href={`/watch/${c.slug}`}>{t("select.watch")}</Link>
                      </Button>
                    )}
                    <Button variant="outline" size="lg" className="max-md:h-11" asChild>
                      <Link href={`/c/${c.slug}`}>{t("select.manage")}</Link>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!owner && (
            <Button variant={channels.length === 0 ? "default" : "outline"} size="lg" className="w-fit max-md:h-11" asChild>
              <Link href="/welcome">{t("select.setup")}</Link>
            </Button>
          )}
        </section>

        <section className="animate-enter flex flex-col gap-3" style={{ animationDelay: "160ms" }}>
          <h2 className="font-serif text-team">{t("select.watch_channel")}</h2>
          <form className="flex items-start gap-2" onSubmit={watch}>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Input
                aria-label={t("select.watch_channel")}
                placeholder={t("select.watch_input")}
                className="h-9 max-md:h-11"
                list="watched"
                spellCheck={false}
                autoCapitalize="none"
                value={name}
                aria-invalid={invalid}
                onChange={(e) => {
                  setName(e.target.value);
                  setInvalid(false);
                }}
              />
              {/* The channels this browser watched (the last 8): the browser's own suggestions. */}
              <datalist id="watched">
                {recent.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {invalid && <p className="text-meta text-destructive">{t("select.watch_invalid")}</p>}
            </div>
            <Button type="submit" variant="outline" size="lg" className="max-md:h-11" disabled={!name.trim()}>
              {t("select.watch")}
            </Button>
          </form>
        </section>
      </main>

      <footer className={HOME_FOOTER}>
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
