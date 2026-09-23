"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { db } from "@/lib/supabase/browser";
import type { Onboarded, OnboardSettings } from "@/types";

// DESIGN.md § Onboarding: three stacked steps, each finishing in place. Stage 3 ships it
// working; Stage 4 moves these English strings to label keys and the look to the DESIGN.md tokens.
const REGIONS = ["tr1", "euw1", "eun1", "me1", "na1", "br1", "la1", "la2", "oc1", "kr", "jp1", "ru", "ph2", "sg2", "th2", "tw2", "vn2"];
const FAILED: Record<Exclude<Onboarded, { ok: true }>["error"], string> = {
  auth: "Your sign-in has expired. Sign in with Kick again.",
  kick: "Couldn't reach Kick to read your channel.",
  slug: "Another channel still uses this address. Try again in a minute.",
  db: "Couldn't save your channel.",
};

type Row = { _t: string; kick_username?: string; riot_id?: string | null };

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-3 font-medium">
        <span className={`flex size-7 items-center justify-center rounded-full text-sm ${done ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Welcome({ username, setup }: { username: string; setup: () => Promise<Onboarded> }) {
  const [channel, setChannel] = useState<Onboarded | null>(null);
  const [form, setForm] = useState<OnboardSettings | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [first, setFirst] = useState<{ name: string; riot: string | null } | null>(null);

  const load = useCallback(() => {
    setup().then((r) => {
      setChannel(r);
      if (r.ok) setForm(r.settings);
    }, () => setChannel({ ok: false, error: "db" }));
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
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <h1 className="font-serif text-3xl">Welcome</h1>

      <Step n={1} title="Your channel" done={!!channel?.ok}>
        <p>Signed in as <strong>{username}</strong>.</p>
        {!channel && <p className="text-muted-foreground">Setting up your channel…</p>}
        {channel && !channel.ok && (
          <div className="mt-2 flex items-center gap-3">
            <p className="text-destructive">{FAILED[channel.error]}</p>
            {channel.error === "auth" ? (
              <a className="underline" href="/login?callbackUrl=/welcome">Sign in</a>
            ) : (
              <Button size="sm" variant="outline" onClick={run}>Retry</Button>
            )}
          </div>
        )}
        {channel?.ok && (
          <p className="mt-1 text-muted-foreground">
            kick.com/{channel.slug}
            {channel.subscriptionError ? (
              <>
                {" · "}<span className="text-destructive">Couldn&apos;t connect to your chat yet.</span>{" "}
                <Button size="sm" variant="link" onClick={run}>Retry</Button>
              </>
            ) : (
              " · listening to your chat"
            )}
          </p>
        )}
      </Step>

      <Step n={2} title="How viewers join" done={save === "saved"}>
        {form ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join">Queue command</Label>
              <Input id="join" className="font-mono" value={form.join_command} onChange={(e) => set({ join_command: e.target.value })} />
              <p className="text-sm text-muted-foreground">What viewers type in chat to join, followed by their Riot ID.</p>
              {(save === "join_command" || save === "commands") && (
                <p className="text-sm text-destructive">Use ! followed by a word, different from your other commands.</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="riot">Require Riot ID</Label>
                <p className="text-sm text-muted-foreground">Turn away a join without Name#TAG.</p>
              </div>
              <Switch id="riot" checked={form.require_riot_id} onCheckedChange={(v) => set({ require_riot_id: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Riot region</Label>
                <Select value={form.riot_region} onValueChange={(v) => set({ riot_region: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => <SelectItem key={r} value={r}>{r.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">Where ranks are looked up.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Stream language</Label>
                <Select value={form.stream_locale} onValueChange={(v) => set({ stream_locale: v as "en" | "tr" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="tr">Türkçe</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">For the overlay and chat replies.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={saveSettings} disabled={save === "saving"}>Save</Button>
              {save === "saved" && <span className="text-sm text-muted-foreground">Saved</span>}
              {save === "form" && <span className="text-sm text-destructive">Couldn&apos;t save. Try again.</span>}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Available once your channel is set up.</p>
        )}
      </Step>

      <Step n={3} title="Try it" done={!!first}>
        {channel?.ok && form ? (
          <div className="flex flex-col gap-3">
            {first ? (
              <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                <span className="font-medium">{first.name}</span>
                <span className="font-mono text-sm text-muted-foreground">{first.riot ?? ""}</span>
              </div>
            ) : (
              <p>
                Type <code className="font-mono">{form.join_command} Name#TAG</code> in your chat now. Waiting for it…
              </p>
            )}
            <div className="flex items-center gap-4">
              {first && <Button asChild><a href={`/c/${channel.slug}`}>Open the dashboard</a></Button>}
              {!first && <a className="text-sm text-muted-foreground underline" href={`/c/${channel.slug}`}>Skip</a>}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Available once your channel is set up.</p>
        )}
      </Step>
    </main>
  );
}
