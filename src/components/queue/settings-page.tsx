"use client";
import {
  ArrowLeft,
  Ban,
  DoorOpen,
  Eye,
  Languages,
  type LucideIcon,
  MessageSquare,
  MonitorPlay,
  RotateCcw,
  Shield,
  Star,
  Swords,
  Terminal,
  Trophy,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n";
import { BadgePicker } from "@/components/queue/badge-picker";
import { OverlaysSection } from "@/components/queue/overlays-section";
import { confirm } from "@/components/queue/confirm";
import { Tag } from "@/components/queue/player-row";
import { useAct, useCanWrite, useErrorText, useQueue, useServerActions } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Tip } from "@/components/tip";
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
import { AFTER_GAME, type AfterGame, DRAW_REVEALS, type Settings, type WatchSection } from "@/types/queue";
import { SECTION, SECTION_CARD, SETTINGS_GRID, SETTINGS_ITEM, SETTINGS_LIST } from "@/components/queue/geometry";
import { SETTINGS, SETTINGS_TITLES, type SettingsSection } from "@/components/queue/tabs";
import { DEFAULTS } from "@/lib/defaults";

const REGIONS = ["tr1", "euw1", "eun1", "me1", "ru", "na1", "br1", "la1", "la2", "oc1", "kr", "jp1", "ph2", "sg2", "th2", "tw2", "vn2"];
const SECTIONS: WatchSection[] = ["teams", "queue", "games", "moderation", "riot_ids"];
const COMMANDS = ["join_command", "leave_command", "position_command", "perk_command", "away_command"] as const;

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

export function Section({ title, hint, children, onEnter }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  // Enter in one of the section's text fields saves it (owner, 2026-09-27; never written as a hint).
  onEnter?: () => void;
}) {
  const ui = useUi();
  const e = enter(ui.entering, 3);
  return (
    <section
      style={e.style}
      className={cn(SECTION, e.className)}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-team">{title}</h2>
        {/* Only where the section has a rule its controls do not show (D21: subtitles went). */}
        {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
      </div>
      <div
        className={SECTION_CARD}
        onKeyDown={(e) => {
          if (!onEnter || e.key !== "Enter" || e.nativeEvent.isComposing || !(e.target instanceof HTMLInputElement)) return;
          e.preventDefault();
          onEnter();
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function Field({ id, label, hint, error, children }: { id?: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
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
export function SwitchField({ id, label, hint, checked, onChange, disabled }: {
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
export function SaveRow({ s, manual = true }: { s: { dirty: boolean; save: () => Promise<unknown> | void; state: string; errors: Errors }; manual?: boolean }) {
  const { t } = useT();
  const canWrite = useCanWrite();
  if (!manual && !s.errors.form && s.state !== "saved") return null;
  return (
    <div className="flex min-h-9 items-center justify-end gap-3">
      {s.errors.form && <p className="mr-auto text-meta text-destructive">{s.errors.form}</p>}
      {s.state === "saved" && !s.dirty && <span className="text-meta text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-200">{t("common.saved")}</span>}
      {manual && (
        <Button variant="outline" size="lg" className="max-md:h-11" disabled={!s.dirty || s.state === "saving" || !canWrite} onClick={() => void s.save()}>
          {t("common.save")}
        </Button>
      )}
    </div>
  );
}

export const inputCls = "h-9 max-md:h-11";
export const triggerCls = "h-9! w-full max-md:h-11!";

function CommandsSection() {
  const { t } = useT();
  const s = useSection(COMMANDS);
  return (
    <Section title={t("settings.commands")} onEnter={() => void s.save()}>
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
      </div>
      {s.errors.commands && <p className="text-meta text-destructive">{t("settings.commands.clash")}</p>}
      <SaveRow s={s} />
    </Section>
  );
}

// The chat !join rules (D23, 0032). Joining open is the toolbar's write too (set_join_open), so it
// reads the live value; the numbers wait for Save, the switch and the picker save as they change.
function JoiningSection() {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const open = useQueue((v) => v.settings.join_open);
  const cmd = useQueue((v) => v.settings.join_command);
  const s = useSection(["queue_max", "join_cooldown", "join_subs_only", "join_badges"] as const);
  return (
    <Section title={t("settings.joining")} onEnter={() => void s.save()}>
      <SwitchField
        id="join_open"
        label={t("settings.join_open")}
        hint={t("settings.join_open.hint", { cmd })}
        checked={open}
        disabled={!canWrite}
        onChange={(v) => void act("set_join_open", { p_open: v })}
      />
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field id="queue_max" label={t("settings.queue_max")} hint={t("settings.queue_max.hint")} error={s.errors.queue_max}>
          <NumberInput id="queue_max" value={s.draft.queue_max} invalid={!!s.errors.queue_max} onChange={(v) => s.set("queue_max", v)} />
        </Field>
        <Field id="join_cooldown" label={t("settings.join_cooldown")} hint={t("settings.join_cooldown.hint")} error={s.errors.join_cooldown}>
          <NumberInput id="join_cooldown" value={s.draft.join_cooldown} invalid={!!s.errors.join_cooldown} onChange={(v) => s.set("join_cooldown", v)} />
        </Field>
      </div>
      <SwitchField
        id="join_subs_only"
        label={t("settings.join_subs_only")}
        hint={t("settings.join_subs_only.hint")}
        checked={s.draft.join_subs_only}
        onChange={(v) => void s.put("join_subs_only", v)}
      />
      {s.draft.join_subs_only && (
        <BadgePicker
          label={t("settings.join_badges")}
          value={s.draft.join_badges}
          onChange={(v) => void s.put("join_badges", v)}
          effect={(who, on) => t(on ? "settings.join_badges.on" : "settings.join_badges.off", { who })}
          result={(who) => t("settings.join.viewer", { who })}
          refusal={t("settings.join_badges.refused")}
        />
      )}
      <SaveRow s={s} />
    </Section>
  );
}

function RiotSection() {
  const { t } = useT();
  const s = useSection(["riot_enabled", "require_riot_id", "riot_region"] as const);
  const players = useQueue((v) => v.players);
  // The switch changes the players (0026, owner 2026-09-28): on removes whoever has no Riot ID,
  // off clears every Riot ID. Asked first, with the count, whenever someone is affected.
  async function requireRiot(on: boolean) {
    const n = players.filter((p) => (on ? !p.riot_id : p.riot_id || p.puuid)).length;
    const k = on ? "riot_on" : "riot_off";
    if (n > 0 && !(await confirm({ title: t(`confirm.${k}.title`), body: t(`confirm.${k}.body`, { n }), action: t(`confirm.${k}.action`) }))) return;
    await s.put("require_riot_id", on);
  }
  return (
    <Section title={t("settings.riot")}>
      {/* Riot IDs first, ranks under them: a lookup needs a Riot ID (owner, 2026-09-28). Look up
          ranks keeps its own value while Riot IDs are off, and shows off and disabled. */}
      <SwitchField id="require_riot_id" label={t("settings.require_riot_id")} hint={t("settings.require_riot_id.hint")} checked={s.draft.require_riot_id} onChange={(v) => void requireRiot(v)} />
      <SwitchField
        id="riot_enabled"
        label={t("settings.riot_enabled")}
        hint={t(s.draft.require_riot_id ? "settings.riot_enabled.hint" : "settings.riot_enabled.needs")}
        checked={s.draft.require_riot_id && s.draft.riot_enabled}
        disabled={!s.draft.require_riot_id}
        onChange={(v) => void s.put("riot_enabled", v)}
      />
      {s.draft.require_riot_id && s.draft.riot_enabled && (
        <>
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

// A whole number typed into a section's draft (Save keeps it).
function NumberInput({ id, value, invalid, onChange }: { id: string; value: number; invalid: boolean; onChange: (v: number) => void }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      className={cn(inputCls, "tabular-nums")}
      value={String(value)}
      aria-invalid={invalid}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
    />
  );
}

function TeamsSection() {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const s = useSection(["team_size", "draw_reveal", "clear_on_offline"] as const);
  return (
    <Section title={t("settings.teams")}>
      <Field label={t("settings.team_size")} error={s.errors.team_size}>
        <Select value={String(s.draft.team_size)} onValueChange={(v) => void s.put("team_size", Number(v))}>
          <SelectTrigger className={cn(triggerCls, "max-w-60")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {[1, 2, 3, 4, 5].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {/* The Teams tab's switch, the same write (set_fair_play keeps no inverse, so no toast). */}
      <SwitchField id="fair_play" label={t("teams.fair_play")} checked={fairPlay} disabled={!canWrite} onChange={(on) => void act("set_fair_play", { p_on: on })} />
      <Field label={t("settings.draw_reveal")} hint={t("settings.draw_reveal.hint")}>
        <Select value={s.draft.draw_reveal} onValueChange={(v) => void s.put("draw_reveal", v as Settings["draw_reveal"])}>
          <SelectTrigger className={cn(triggerCls, "max-w-60")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {DRAW_REVEALS.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`settings.draw_reveal.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SwitchField
        id="clear_on_offline"
        label={t("settings.clear_on_offline")}
        hint={t("settings.clear_on_offline.hint")}
        checked={s.draft.clear_on_offline}
        onChange={(v) => void s.put("clear_on_offline", v)}
      />
      <SaveRow s={s} manual={false} />
    </Section>
  );
}

function GamesSection() {
  const { t } = useT();
  const s = useSection(["after_game", "games_retention_days"] as const);
  return (
    <Section title={t("settings.games")} onEnter={() => void s.save()}>
      <Field label={t("settings.after_game")} hint={t("settings.after_game.hint")}>
        <Select value={s.draft.after_game} onValueChange={(v) => void s.put("after_game", v as AfterGame)}>
          <SelectTrigger className={cn(triggerCls, "max-w-80")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {AFTER_GAME.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`settings.after_game.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="games_retention_days" label={t("settings.games_retention_days")} hint={t("settings.games_retention_days.hint", { min: DEFAULTS.limits.games_retention_days[0], max: DEFAULTS.limits.games_retention_days[1] })} error={s.errors.games_retention_days}>
        <div className="max-w-60"><NumberInput id="games_retention_days" value={s.draft.games_retention_days} invalid={!!s.errors.games_retention_days} onChange={(v) => s.set("games_retention_days", v)} /></div>
      </Field>
      <SaveRow s={s} />
    </Section>
  );
}

function PerksSection() {
  const { t } = useT();
  const s = useSection(["perk_enabled", "perk_uses", "perk_window_days", "perk_badges"] as const);
  return (
    <Section title={t("settings.perks")} onEnter={() => void s.save()}>
      <SwitchField id="perk_enabled" label={t("settings.perk_enabled")} hint={t("settings.perk_enabled.hint")} checked={s.draft.perk_enabled} onChange={(v) => void s.put("perk_enabled", v)} />
      {s.draft.perk_enabled && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field id="perk_uses" label={t("settings.perk_uses")} error={s.errors.perk_uses}>
              <NumberInput id="perk_uses" value={s.draft.perk_uses} invalid={!!s.errors.perk_uses} onChange={(v) => s.set("perk_uses", v)} />
            </Field>
            <Field id="perk_window_days" label={t("settings.perk_window_days")} error={s.errors.perk_window_days}>
              <NumberInput id="perk_window_days" value={s.draft.perk_window_days} invalid={!!s.errors.perk_window_days} onChange={(v) => s.set("perk_window_days", v)} />
            </Field>
          </div>
          <BadgePicker
            label={t("settings.perk_badges")}
            value={s.draft.perk_badges}
            onChange={(v) => void s.put("perk_badges", v)}
            effect={(who, on) => t(on ? "settings.perk_badges.on" : "settings.perk_badges.off", { who })}
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
    <Section title={t("settings.mods")} hint={t("settings.mods.hint")}>
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

const noop = () => () => {};

function WatchSectionSettings() {
  const { t } = useT();
  const s = useSection(["watch_enabled", "watch_sections"] as const);
  const slug = useQueue((v) => v.channel.slug);
  const riot = useQueue((v) => v.settings.require_riot_id);
  const origin = useSyncExternalStore(noop, () => location.origin, () => "");
  const toggle = (x: WatchSection, on: boolean) =>
    void s.put("watch_sections", on ? [...s.draft.watch_sections, x] : s.draft.watch_sections.filter((y) => y !== x));
  return (
    <Section title={t("settings.watch")}>
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
      {/* This site's own address (a preview links to itself). Overlays have their own section,
          each with its own key (Stage 13). */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
        <dt className="text-muted-foreground">{t("settings.watch.link")}</dt>
        <dd className="font-mono text-code break-all">
          <a href={`/watch/${slug}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {`${origin}/watch/${slug}`}
          </a>
        </dd>
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
    <Section title={t("settings.labels")} hint={t("settings.labels.hint", { lang: t(`lang.name.${lang}`) })} onEnter={() => void s.save()}>
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
            <Tip label={own[k] ? t("settings.labels.reset") : null}>
              <Button
                variant="ghost"
                size="icon-lg"
                className={cn("max-md:size-11", !own[k] && "invisible")}
                aria-label={t("settings.labels.reset")}
                onClick={() => setLabel(k, "")}
              >
                <RotateCcw aria-hidden />
              </Button>
            </Tip>
          </div>
        ))}
      </div>
      {s.errors.labels && <p className="text-meta text-destructive">{s.errors.labels}</p>}
      <SaveRow s={s} />
    </Section>
  );
}


// Each section's icon in its own colour (owner, 2026-09-28).
const SECTION_META: Record<SettingsSection, { icon: LucideIcon; tone: string; body: () => React.ReactNode }> = {
  commands: { icon: Terminal, tone: "text-brand", body: CommandsSection },
  joining: { icon: DoorOpen, tone: "text-warning", body: JoiningSection },
  riot: { icon: Swords, tone: "text-team-2", body: RiotSection },
  teams: { icon: Users, tone: "text-team-1", body: TeamsSection },
  games: { icon: Trophy, tone: "text-brand", body: GamesSection },
  perks: { icon: Star, tone: "text-brand", body: PerksSection },
  watch: { icon: Eye, tone: "text-badge-founder", body: WatchSectionSettings },
  overlays: { icon: MonitorPlay, tone: "text-badge-og", body: OverlaysSection },
  moderators: { icon: Shield, tone: "text-success", body: ModeratorsSection },
  labels: { icon: Languages, tone: "text-badge-vip", body: LabelsSection },
};

// The Settings page (D20, D30; DESIGN.md § Settings page): the section list beside one section,
// the section in the URL. Moving between sections is a history entry, not a server round trip
// (pushState keeps usePathname in step). On phones the list is the page and a section its own
// screen; with no section in the URL a wide screen opens the first.
export function SettingsPage() {
  const { t } = useT();
  const ui = useUi();
  const slug = useQueue((v) => v.channel.slug);
  const at = usePathname().split("/")[4];
  const open = SETTINGS.find((s) => s === at) ?? null;
  const shown = open ?? "commands";
  const base = `/c/${slug}/settings`;
  const go = (e: React.MouseEvent, s: SettingsSection) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    // From an overlay's builder, Overlays goes back to its list.
    if (window.location.pathname !== `${base}/${s}`) window.history.pushState(null, "", `${base}/${s}`);
  };
  const e2 = enter(ui.entering, 2);
  const Body = SECTION_META[shown].body;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t("tab.settings")}</h1>
      <Button variant="ghost" size="lg" className={cn("-ml-3 w-fit max-md:h-11", open && "max-lg:hidden")} asChild>
        <Link href={`/c/${slug}?tab=queue`}>
          <ArrowLeft aria-hidden />
          {t("tab.queue")}
        </Link>
      </Button>
      {open && (
        <Button variant="ghost" size="lg" className="-ml-3 w-fit max-md:h-11 lg:hidden" asChild>
          <Link href={base}>
            <ArrowLeft aria-hidden />
            {t("tab.settings")}
          </Link>
        </Button>
      )}
      <div className={SETTINGS_GRID}>
        <nav aria-label={t("settings.nav")} style={e2.style} className={cn(SETTINGS_LIST, e2.className, open && "max-lg:hidden")}>
          {SETTINGS.map((s) => {
            const { icon: Icon, tone } = SECTION_META[s];
            return (
              <a
                key={s}
                href={`${base}/${s}`}
                onClick={(e) => go(e, s)}
                aria-current={s === shown ? "page" : undefined}
                className={cn(
                  SETTINGS_ITEM,
                  "group/sec text-muted-foreground outline-none select-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                  // On phones nothing is open while the list is the page.
                  s === shown && (open ? "text-foreground" : "lg:text-foreground"),
                )}
              >
                {/* The tabs' motion: a tilt and a lift on hover; the tabs' gold line under the
                    active label, growing from its centre. */}
                <Icon aria-hidden className={cn("size-4.5 shrink-0 transition-[rotate,scale] duration-200 ease-out group-hover/sec:-rotate-6 group-hover/sec:scale-115 motion-reduce:transition-none", tone)} />
                <span
                  className={cn(
                    "relative after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:after:transition-none",
                    s === shown && (open ? "after:scale-x-100" : "lg:after:scale-x-100"),
                  )}
                >
                  {t(SETTINGS_TITLES[s])}
                </span>
              </a>
            );
          })}
        </nav>
        <div className={cn(!open && "max-lg:hidden")}>
          <Body key={shown} />
        </div>
      </div>
    </div>
  );
}
