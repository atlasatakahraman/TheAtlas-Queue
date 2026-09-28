"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { ThemeButton } from "@/components/theme-button";
import { Typed } from "@/components/prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LabelKey } from "@/lib/i18n";
import { db } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { Onboarded, OnboardSettings } from "@/types";
import { STEP, STEP_HEAD, WELCOME } from "@/components/queue/geometry";

// DESIGN.md § Onboarding: three stacked steps, each finishing in place. No wizard, no Next.
const REGIONS = ["tr1", "euw1", "eun1", "me1", "ru", "na1", "br1", "la1", "la2", "oc1", "kr", "jp1", "ph2", "sg2", "th2", "tw2", "vn2"];

type Row = { _t: string; kick_username?: string; riot_id?: string | null };

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className={STEP}>
      <h2 className={STEP_HEAD}>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border font-serif text-numeral tabular-nums select-none",
            done ? "border-success/45 text-success" : "border-row-edge text-muted-foreground",
          )}
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Welcome({ username, setup }: { username: string; setup: () => Promise<Onboarded> }) {
  const { t } = useT();
  const [channel, setChannel] = useState<Onboarded | null>(null);
  const [form, setForm] = useState<OnboardSettings | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [first, setFirst] = useState<{ name: string; riot: string | null } | null>(null);

  const load = useCallback(() => {
    setup().then(
      (r) => {
        setChannel(r);
        if (r.ok) setForm(r.settings);
      },
      () => setChannel({ ok: false, error: "db" }),
    );
  }, [setup]);
  useEffect(load, [load]);
  const run = () => {
    setChannel(null);
    load();
  };

  // Step 3: the first chat join arrives on the channel's private realtime topic.
  const channelId = channel?.ok ? channel.channelId : null;
  useEffect(() => {
    if (!channelId) return;
    const topic = db()
      .channel(`ch:${channelId}`, { config: { private: true } })
      .on("broadcast", { event: "change" }, ({ payload }) => {
        if (payload?.kind !== "chat_join") return;
        const row = (payload.rows as Row[]).find((r) => r._t === "players");
        if (row?.kick_username) setFirst({ name: row.kick_username, riot: row.riot_id ?? null });
      });
    db().realtime.setAuth().then(() => topic.subscribe());
    return () => {
      db().removeChannel(topic);
    };
  }, [channelId]);

  async function saveSettings() {
    if (!channelId || !form) return;
    setSave("saving");
    const { error } = await db().rpc("update_settings", { p_channel: channelId, p_patch: form, p_request_id: crypto.randomUUID() });
    if (!error) return setSave("saved");
    let field: string | undefined;
    try {
      field = JSON.parse(error.details || "{}").field;
    } catch {}
    setSave(error.message === "settings.invalid" && field ? field : "form");
    if (process.env.NODE_ENV !== "production") console.error(error);
  }

  const set = (patch: Partial<OnboardSettings>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSave("idle");
  };

  return (
    <main className={WELCOME}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-display max-md:text-title">
            <Typed text={t("welcome.title")} />
          </h1>
          <p className="text-muted-foreground">{t("welcome.hint")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 animate-enter" style={{ animationDelay: "70ms" }}>
          <LangSwitch />
          <ThemeButton />
        </div>
      </header>

      <Step n={1} title={t("welcome.step.channel")} done={!!channel?.ok}>
        <p>{t("welcome.signed_in", { name: username })}</p>
        {!channel && <p className="text-muted-foreground">{t("welcome.setting_up")}</p>}
        {channel && !channel.ok && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-destructive selection:bg-destructive selection:text-background">{t(`welcome.error.${channel.error}`)}</p>
            {channel.error === "auth" ? (
              <Button asChild size="lg" variant="outline">
                <Link href="/?callbackUrl=/welcome">{t("welcome.sign_in")}</Link>
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={run}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        )}
        {channel?.ok && (
          <p className="flex flex-wrap items-center gap-x-3 text-meta text-muted-foreground">
            <a href={`https://kick.com/${channel.slug}`} target="_blank" rel="noreferrer" className="font-mono text-code underline-offset-2 hover:underline">
              kick.com/{channel.slug}
            </a>
            {channel.subscriptionError ? (
              <>
                <span className="text-destructive">{t("welcome.not_connected")}</span>
                <Button size="sm" variant="link" className="h-auto p-0" onClick={run}>
                  {t("common.retry")}
                </Button>
              </>
            ) : (
              <span className="text-success">{t("welcome.listening")}</span>
            )}
          </p>
        )}
      </Step>

      <Step n={2} title={t("welcome.step.join")} done={save === "saved"}>
        {form ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join">{t("settings.join_command")}</Label>
              <Input
                id="join"
                className="h-9 max-w-60 font-mono text-code max-md:h-11"
                value={form.join_command}
                spellCheck={false}
                aria-invalid={save === "join_command" || save === "commands"}
                onChange={(e) => set({ join_command: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveSettings();
                }}
              />
              <p className="text-meta text-muted-foreground">{t("welcome.join.hint")}</p>
              {(save === "join_command" || save === "commands") && (
                <p className="text-meta text-destructive">{t("settings.commands.clash")}</p>
              )}
            </div>
            <div className="flex items-start justify-between gap-4">
              <Label htmlFor="riot" className="flex min-h-11 cursor-pointer flex-col items-start gap-0.5 leading-normal md:min-h-0">
                <span className="text-control">{t("settings.require_riot_id")}</span>
                <span className="text-meta font-normal text-muted-foreground">{t("settings.require_riot_id.hint")}</span>
              </Label>
              <Switch id="riot" checked={form.require_riot_id} onCheckedChange={(v) => set({ require_riot_id: v })} className="mt-0.5" />
            </div>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <div className="flex flex-col gap-1.5">
                <Label>{t("settings.riot_region")}</Label>
                <Select value={form.riot_region} onValueChange={(v) => set({ riot_region: v })}>
                  <SelectTrigger className="h-9! w-full max-md:h-11!">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`region.${r}` as LabelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-meta text-muted-foreground">{t("settings.riot_region.hint")}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("settings.stream_locale")}</Label>
                <Select value={form.stream_locale} onValueChange={(v) => set({ stream_locale: v as "en" | "tr" })}>
                  <SelectTrigger className="h-9! w-full max-md:h-11!">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="en">{t("lang.name.en")}</SelectItem>
                    <SelectItem value="tr">{t("lang.name.tr")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-meta text-muted-foreground">{t("settings.stream_locale.hint")}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              {save === "saved" && <span className="text-meta text-muted-foreground">{t("common.saved")}</span>}
              {save === "form" && <span className="text-meta text-destructive">{t("error.generic")}</span>}
              {/* One primary per view: Save until the first join arrives, then Open the dashboard. */}
              <Button size="lg" variant={first ? "outline" : "default"} className="max-md:h-11" onClick={saveSettings} disabled={save === "saving"}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("welcome.after_channel")}</p>
        )}
      </Step>

      <Step n={3} title={t("welcome.step.try")} done={!!first}>
        {channel?.ok && form ? (
          <div className="flex flex-col gap-4">
            {first ? (
              <div className="flex items-center gap-3 rounded-xl border border-l-[3px] border-row-edge bg-background px-4 py-3 animate-arrive">
                <span className="w-7 font-serif text-numeral text-muted-foreground tabular-nums">1</span>
                <span className="text-name">{first.name}</span>
                {first.riot && <span className="ml-auto font-mono text-code text-muted-foreground">{first.riot}</span>}
              </div>
            ) : (
              <p>
                {t("welcome.try.before")}{" "}
                <code className="font-mono text-code select-all">{form.join_command} Name#TAG</code>{" "}
                {t("welcome.try.after")}
              </p>
            )}
            <div className="flex items-center gap-4">
              {first ? (
                <Button asChild size="lg">
                  <a href={`/c/${channel.slug}`}>{t("welcome.open")}</a>
                </Button>
              ) : (
                <a className="text-meta text-muted-foreground underline underline-offset-4 hover:text-foreground" href={`/c/${channel.slug}`}>
                  {t("welcome.skip")}
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("welcome.after_channel")}</p>
        )}
      </Step>
    </main>
  );
}
