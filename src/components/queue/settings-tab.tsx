"use client";
import { Ban, MessageSquare, RotateCcw, UserPlus, Video } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { BadgePicker } from "@/components/queue/badge-picker";
import { Tag } from "@/components/queue/player-row";
import { useAct, useCanWrite, useErrorText, useQueue, useServerActions } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CURATED_KEYS, type LabelKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { tr } from "@/lib/i18n/tr";
import { isError, type RpcError } from "@/lib/queue-store";
import { cn } from "@/lib/utils";
import type { Settings, WatchSection } from "@/types/queue";

const REGIONS = ["tr1", "euw1", "eun1", "me1", "ru", "na1", "br1", "la1", "la2", "oc1", "kr", "jp1", "ph2", "sg2", "th2", "tw2", "vn2"];
const SECTIONS: WatchSection[] = ["teams", "queue", "moderation", "riot_ids"];
const COMMANDS = ["join_command", "leave_command", "position_command", "perk_command", "away_command"] as const;
const WATCH_ORIGIN = "https://theatlas-queue.vercel.app";

type Errors = Record<string, string>;

// One section's draft of the settings row: saves a patch of only the keys that changed, and puts
// settings.invalid {field} under that field (spec § Error handling → Form). Switches, selects and
// pickers save the moment they change (put); text and numbers wait for Save, which stays disabled
// until one of them changed (owner, 2026-09-27, superseding ADR 0022's save-on-blur).
function useSection<K extends keyof Settings>(keys: readonly K[]) {
  const settings = useQueue((v) => v.settings);
  const act = useAct();
  const errorText = useErrorText();
  const { t } = useT();
  const [draft, setDraft] = useState(() => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [errors, setErrors] = useState<Errors>({});
  // Keys that save on change never count as unsaved, so Save does not wake while one is in flight.
  const [instant] = useState(() => new Set<K>());
  const changed = keys.filter((k) => !instant.has(k) && JSON.stringify(draft[k]) !== JSON.stringify(settings[k]));
  const failed = (res: RpcError) => {
    const field =
      res.key === "settings.label_invalid" ? "labels" : typeof res.detail.field === "string" ? res.detail.field : "form";
    setErrors({ [field]: res.key === "network" ? t("error.network") : errorText(res) });
  };

  const set = <X extends K>(k: X, v: Settings[X]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setState("idle");
    setErrors({});
  };
  async function save() {
    if (changed.length === 0) return;
    setState("saving");
    const res = await act("update_settings", { p_patch: Object.fromEntries(changed.map((k) => [k, draft[k]])) }, { silent: true });
    if (isError(res)) {
      setState("idle");
      return failed(res);
    }
    setState("saved");
  }
  // Saves this one key now; a refusal puts the control back to the saved value.
  async function put<X extends K>(k: X, v: Settings[X]) {
    instant.add(k);
    set(k, v);
    const res = await act("update_settings", { p_patch: { [k]: v } }, { silent: true });
    if (isError(res)) {
      setDraft((d) => ({ ...d, [k]: settings[k] }));
      return failed(res);
    }
    setState("saved");
  }
  return { draft, set, put, dirty: changed.length > 0, save, state, errors };
}

function Section({ title, hint, children, step }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  step: number;
}) {
  const ui = useUi();
  const e = enter(ui.entering, step);
  return (
    <section
      style={e.style}
      className={cn("grid grid-cols-[16rem_minmax(0,1fr)] gap-6 border-t border-border py-8 first:border-t-0 first:pt-0 max-md:grid-cols-1 max-md:gap-4", e.className)}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-serif text-team">{title}</h3>
        {/* Only where the section has a rule its controls do not show (D21: subtitles went). */}
        {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5 rounded-xl bg-card p-6 max-md:p-4">
        {children}
      </div>
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id?: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      {error && <p className="text-meta text-destructive selection:bg-destructive selection:text-background">{error}</p>}
    </div>
  );
}

// A switch with its label and one line of description, the whole block clickable.
function SwitchField({ id, label, hint, checked, onChange, disabled }: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <Label htmlFor={id} className="flex min-h-11 cursor-pointer flex-col items-start gap-0.5 leading-normal md:min-h-0">
        <span className="text-control">{label}</span>
        {hint && <span className="text-meta font-normal text-muted-foreground">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

// Save for the typed fields; a section of switches and selects only reports (manual false).
function SaveRow({ s, manual = true }: { s: { dirty: boolean; save: () => Promise<unknown> | void; state: string; errors: Errors }; manual?: boolean }) {
  const { t } = useT();
  const canWrite = useCanWrite();
  if (!manual && !s.errors.form && s.state !== "saved") return null;
  return (
    <div className="flex min-h-9 items-center justify-end gap-3">
      {s.errors.form && <p className="mr-auto text-meta text-destructive">{s.errors.form}</p>}
      {s.state === "saved" && !s.dirty && <span className="text-meta text-muted-foreground">{t("common.saved")}</span>}
      {manual && (
        <Button variant="outline" size="lg" className="max-md:h-11" disabled={!s.dirty || s.state === "saving" || !canWrite} onClick={() => void s.save()}>
          {t("common.save")}
        </Button>
      )}
    </div>
  );
}

const inputCls = "h-9 max-md:h-11";
const triggerCls = "h-9! w-full max-md:h-11!";

function QueueSection() {
  const { t } = useT();
  const s = useSection([...COMMANDS, "team_size"] as const);
  return (
    <Section title={t("settings.queue")} step={3}>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {COMMANDS.map((k) => (
          <Field key={k} id={k} label={t(`settings.${k}`)} error={s.errors[k]}>
            <Input
              id={k}
              className={cn(inputCls, "font-mono text-code")}
              value={s.draft[k]}
              spellCheck={false}
              aria-invalid={!!s.errors[k] || !!s.errors.commands}
              onChange={(e) => s.set(k, e.target.value.trim())}
            />
          </Field>
        ))}
        <Field label={t("settings.team_size")} error={s.errors.team_size}>
          <Select value={String(s.draft.team_size)} onValueChange={(v) => void s.put("team_size", Number(v))}>
            <SelectTrigger className={triggerCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t("settings.team_size.n", { n })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {s.errors.commands && <p className="text-meta text-destructive">{t("settings.commands.clash")}</p>}
      <SaveRow s={s} />
    </Section>
  );
}

function RiotSection() {
  const { t } = useT();
  const s = useSection(["riot_enabled", "require_riot_id", "riot_region"] as const);
  return (
    <Section title={t("settings.riot")} step={4}>
      <SwitchField id="riot_enabled" label={t("settings.riot_enabled")} hint={t("settings.riot_enabled.hint")} checked={s.draft.riot_enabled} onChange={(v) => void s.put("riot_enabled", v)} />
      {/* The rest only means something with Riot on (owner, 2026-09-27). */}
      {s.draft.riot_enabled && (
        <>
          <SwitchField id="require_riot_id" label={t("settings.require_riot_id")} hint={t("settings.require_riot_id.hint")} checked={s.draft.require_riot_id} onChange={(v) => void s.put("require_riot_id", v)} />
          <Field label={t("settings.riot_region")} hint={t("settings.riot_region.hint")} error={s.errors.riot_region}>
            <Select value={s.draft.riot_region} onValueChange={(v) => void s.put("riot_region", v)}>
              <SelectTrigger className={cn(triggerCls, "max-w-60")}>
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
          </Field>
        </>
      )}
      <SaveRow s={s} manual={false} />
    </Section>
  );
}

function DrawsSection() {
  const { t } = useT();
  const s = useSection(["draw_reveal", "perk_enabled", "perk_uses", "perk_window_days", "perk_badges"] as const);
  const num = (k: "perk_uses" | "perk_window_days") => (
    <Input
      id={k}
      inputMode="numeric"
      className={cn(inputCls, "tabular-nums")}
      value={String(s.draft[k])}
      aria-invalid={!!s.errors[k]}
      onChange={(e) => s.set(k, Number(e.target.value.replace(/\D/g, "")) || 0)}
    />
  );
  return (
    <Section title={t("settings.draws")} step={5}>
      <Field label={t("settings.draw_reveal")} hint={t("settings.draw_reveal.hint")}>
        <Select value={s.draft.draw_reveal} onValueChange={(v) => void s.put("draw_reveal", v as Settings["draw_reveal"])}>
          <SelectTrigger className={cn(triggerCls, "max-w-60")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="typewriter">{t("settings.draw_reveal.typewriter")}</SelectItem>
            <SelectItem value="none">{t("settings.draw_reveal.none")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <SwitchField id="perk_enabled" label={t("settings.perk_enabled")} hint={t("settings.perk_enabled.hint")} checked={s.draft.perk_enabled} onChange={(v) => void s.put("perk_enabled", v)} />
      {s.draft.perk_enabled && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field id="perk_uses" label={t("settings.perk_uses")} error={s.errors.perk_uses}>
              {num("perk_uses")}
            </Field>
            <Field id="perk_window_days" label={t("settings.perk_window_days")} error={s.errors.perk_window_days}>
              {num("perk_window_days")}
            </Field>
          </div>
          <BadgePicker
            label={t("settings.perk_badges")}
            value={s.draft.perk_badges}
            onChange={(v) => void s.put("perk_badges", v)}
            result={(who) => t("settings.perk.viewer", { who, uses: s.draft.perk_uses, days: s.draft.perk_window_days })}
          />
        </>
      )}
      <SaveRow s={s} />
    </Section>
  );
}

function ModeratorsSection() {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const errorText = useErrorText();
  const channelId = useQueue((v) => v.channel.id);
  const members = useQueue((v) => v.members);
  const [name, setName] = useState("");
  const { findKickUser } = useServerActions();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(undefined);
    const found = await findKickUser(channelId, name);
    if (!found.ok) {
      setBusy(false);
      return setError(t(`settings.mods.find.${found.error}`));
    }
    const res = await act("add_member", { p_kick_user_id: found.id, p_kick_username: found.username }, { silent: true });
    setBusy(false);
    if (isError(res)) return setError(res.key === "network" ? t("error.network") : errorText(res));
    setName("");
  }

  const sorted = [...members].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.created_at.localeCompare(b.created_at)));
  return (
    <Section title={t("settings.mods")} hint={t("settings.mods.hint")} step={6}>
      <div className="flex flex-col gap-1.5">
        {sorted.map((m) => (
          <div
            key={m.kick_user_id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-row-edge bg-background px-4 py-3"
          >
            <span className="min-w-0 truncate text-name">{m.kick_username ?? `#${m.kick_user_id}`}</span>
            <Tag tone={m.role === "owner" ? "brand" : "muted"} icon={{ owner: Video, badge: MessageSquare, manual: UserPlus }[m.source]}>{t(`settings.mods.source.${m.source}`)}</Tag>
            {m.blocked && <Tag tone="destructive" icon={Ban}>{t("settings.mods.blocked")}</Tag>}
            {m.role !== "owner" && (
              <span className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  disabled={!canWrite}
                  onClick={() => act("set_member_blocked", { p_kick_user_id: m.kick_user_id, p_blocked: !m.blocked })}
                >
                  {t(m.blocked ? "settings.mods.unblock" : "settings.mods.block")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive max-md:h-11"
                  disabled={!canWrite}
                  onClick={() => act("remove_member", { p_kick_user_id: m.kick_user_id })}
                >
                  {t("settings.mods.remove")}
                </Button>
              </span>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Input
            aria-label={t("settings.mods.add.label")}
            placeholder={t("settings.mods.add.placeholder")}
            className={inputCls}
            value={name}
            aria-invalid={!!error}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
          />
          {error && <p className="text-meta text-destructive">{error}</p>}
        </div>
        <Button type="submit" variant="outline" size="lg" className="max-md:h-11" disabled={busy || !name.trim() || !canWrite}>
          {t("settings.mods.add")}
        </Button>
      </form>
    </Section>
  );
}

function WatchSectionSettings() {
  const { t } = useT();
  const s = useSection(["watch_enabled", "watch_sections"] as const);
  const slug = useQueue((v) => v.channel.slug);
  const riot = useQueue((v) => v.settings.riot_enabled);
  const toggle = (x: WatchSection, on: boolean) =>
    void s.put("watch_sections", on ? [...s.draft.watch_sections, x] : s.draft.watch_sections.filter((y) => y !== x));
  return (
    <Section title={t("settings.watch")} step={7}>
      <SwitchField id="watch_enabled" label={t("settings.watch_enabled")} hint={t("settings.watch_enabled.hint")} checked={s.draft.watch_enabled} onChange={(v) => void s.put("watch_enabled", v)} />
      {SECTIONS.filter((x) => riot || x !== "riot_ids").map((x) => (
        <SwitchField
          key={x}
          id={`watch-${x}`}
          label={t(`settings.watch.${x}`)}
          hint={x === "moderation" ? t("settings.watch.moderation.hint") : undefined}
          checked={s.draft.watch_sections.includes(x)}
          disabled={!s.draft.watch_enabled}
          onChange={(on) => toggle(x, on)}
        />
      ))}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
        <dt className="text-muted-foreground">{t("settings.watch.link")}</dt>
        <dd className="font-mono text-code break-all select-all">{`${WATCH_ORIGIN}/watch/${slug}`}</dd>
        <dt className="text-muted-foreground">{t("settings.watch.overlay")}</dt>
        <dd className="font-mono text-code break-all select-all">{`${WATCH_ORIGIN}/overlay/${slug}?view=teams`}</dd>
      </dl>
      <SaveRow s={s} manual={false} />
    </Section>
  );
}

// Labels & language (DESIGN.md § Language and labels): edits the language picked in the
// masthead; an empty value falls back to the default; ↺ clears the override.
function LabelsSection() {
  const { t, lang } = useT();
  const s = useSection(["labels", "stream_locale"] as const);
  const defaults = lang === "tr" ? tr : en;
  const own = s.draft.labels[lang] ?? {};
  const setLabel = (k: string, v: string) => {
    const next = { ...own, [k]: v };
    if (!v) delete next[k];
    s.set("labels", { ...s.draft.labels, [lang]: next });
  };
  return (
    <Section title={t("settings.labels")} hint={t("settings.labels.hint", { lang: t(`lang.name.${lang}`) })} step={8}>
      <Field label={t("settings.stream_locale")} hint={t("settings.stream_locale.hint")}>
        <Select value={s.draft.stream_locale} onValueChange={(v) => void s.put("stream_locale", v as Settings["stream_locale"])}>
          <SelectTrigger className={cn(triggerCls, "max-w-60")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="en">{t("lang.name.en")}</SelectItem>
            <SelectItem value="tr">{t("lang.name.tr")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex flex-col gap-1.5">
        {CURATED_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-row-edge bg-background px-4 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col max-md:col-span-2">
              <span className="text-control">{t(`labelname.${k}` as LabelKey)}</span>
              <code className="truncate font-mono text-code text-muted-foreground select-all">{k}</code>
            </div>
            <Input
              aria-label={t(`labelname.${k}` as LabelKey)}
              className={inputCls}
              maxLength={80}
              placeholder={defaults[k] || t("settings.labels.empty")}
              value={own[k] ?? ""}
              onChange={(e) => setLabel(k, e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon-lg"
              className={cn("max-md:size-11", !own[k] && "invisible")}
              aria-label={t("settings.labels.reset")}
              onClick={() => setLabel(k, "")}
            >
              <RotateCcw aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      {s.errors.labels && <p className="text-meta text-destructive">{s.errors.labels}</p>}
      <SaveRow s={s} />
    </Section>
  );
}

export function SettingsTab() {
  const { t } = useT();
  const ui = useUi();
  const e = enter(ui.entering, 2);
  return (
    <div className="flex flex-col">
      <h2 style={e.style} className={cn("mb-6 font-serif text-title", e.className)}>
        {t("tab.settings")}
      </h2>
      <QueueSection />
      <RiotSection />
      <DrawsSection />
      <ModeratorsSection />
      <WatchSectionSettings />
      <LabelsSection />
    </div>
  );
}
