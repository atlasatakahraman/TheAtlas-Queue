"use client";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n";
import { useMoveTo } from "@/components/queue/player-row";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useAct, useCanWrite, useErrorText, useQueue, useServerActions } from "@/components/queue/store";
import { useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNow } from "@/components/use-now";
import { isError, type RpcError } from "@/lib/queue-store";
import { ago } from "@/lib/time";
import type { ChangeEvent, Player } from "@/types/queue";

const NAME = /^\S{1,40}$/;
const RIOT_ID = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/u;
const NAME_ERRORS = new Set(["queue.duplicate", "queue.banned", "queue.punished"]);

type Errors = { name?: string; riot?: string; form?: string };

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-meta text-destructive selection:bg-destructive selection:text-background">
      {children}
    </p>
  );
}

// Maps an RPC error to the field it belongs under; anything else stays on the form.
function useFieldErrors() {
  const errorText = useErrorText();
  const { t } = useT();
  return (e: RpcError): Errors => {
    if (e.key === "network") return { form: t("error.network") };
    if (NAME_ERRORS.has(e.key)) return { name: errorText(e) };
    if (e.key === "queue.riot_required") return { riot: errorText(e) };
    return { form: errorText(e) };
  };
}

function RiotField({ value, onChange, error, required }: { value: string; onChange: (v: string) => void; error?: string; required: boolean }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="riot-id">{t("player.riot")}</Label>
      <Input
        id="riot-id"
        className="h-9 font-mono text-code max-md:h-11"
        placeholder="Name#TAG"
        autoComplete="off"
        spellCheck={false}
        required={required}
        value={value}
        aria-invalid={!!error}
        aria-describedby={error ? "riot-error" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError id="riot-error">{error}</FieldError>
    </div>
  );
}

// Add player (DESIGN.md § Recipes): a Command picker over names recently seen in chat; a typed
// name that matches nothing is added as it is. The Riot ID field exists only while required.
export function AddPlayerDialog() {
  const { t } = useT();
  const ui = useUi();
  return (
    <ResponsiveDialog
      open={ui.adding}
      onOpenChange={ui.setAdding}
      title={ui.addTo ? t("teams.add", { team: t(`team.${ui.addTo}`) }) : t("action.add")}
    >
      {ui.adding && <AddPlayerForm team={ui.addTo} onDone={() => ui.setAdding(false)} />}
    </ResponsiveDialog>
  );
}

function AddPlayerForm({ team, onDone }: { team: 1 | 2 | null; onDone: () => void }) {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const fieldErrors = useFieldErrors();
  const { lookupRank } = useServerActions();
  const moveTo = useMoveTo();
  const now = useNow();
  const channelId = useQueue((v) => v.channel.id);
  const required = useQueue((v) => v.settings.require_riot_id);
  const riotEnabled = useQueue((v) => v.settings.riot_enabled);
  const activity = useQueue((v) => v.activity);
  const players = useQueue((v) => v.players);
  const [name, setName] = useState("");
  const [riot, setRiot] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  // Names seen in chat lately and not in the queue now, newest first.
  const recent = useMemo(() => {
    const inQueue = new Set(players.map((p) => p.kick_username.toLowerCase()));
    const seen = new Map<string, { name: string; at: string; riot: string | null }>();
    for (const a of activity) {
      if (a.actor !== null || !a.action.startsWith("chat_") || !a.target) continue;
      const k = a.target.toLowerCase();
      if (inQueue.has(k) || seen.has(k)) continue;
      seen.set(k, { name: a.target, at: a.created_at, riot: (a.payload.riot_id as string | null) ?? null });
    }
    return [...seen.values()].slice(0, 20);
  }, [activity, players]);
  const q = name.trim().toLowerCase();
  const matches = recent.filter((r) => r.name.toLowerCase().includes(q) && r.name.toLowerCase() !== q).slice(0, 8);

  async function submit() {
    const n = name.trim();
    const r = riot.trim().replace(/\s+/g, " ");
    const next: Errors = {};
    if (!NAME.test(n)) next.name = t("player.name.invalid");
    if (required && !r) next.riot = t("error.queue.riot_required");
    else if (r && !RIOT_ID.test(r)) next.riot = t("error.queue.riot_required");
    setErrors(next);
    if (next.name || next.riot) return;
    setBusy(true);
    const res = await act(
      "add_player",
      { p_kick_username: n, p_riot_id: r || null },
      { done: "done.add", vars: { name: n }, silent: true },
    );
    setBusy(false);
    if (isError(res)) return setErrors(fieldErrors(res));
    if (r && riotEnabled) void lookupRank(channelId, r);
    onDone();
    // From a team card: straight into that team, as a second (undoable) step.
    const added = (res as ChangeEvent).rows.find((row) => row._t === "players") as unknown as Player | undefined;
    if (team && added) void moveTo(added, team);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        {/* cmdk sets its own id on the input, so the label names it through aria-label. */}
        <Label asChild>
          <span>{t("player.name")}</span>
        </Label>
        <Command shouldFilter={false} className="bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-9! max-md:[&_[data-slot=input-group]]:h-11!">
          <CommandInput
            aria-label={t("player.name")}
            autoFocus
            value={name}
            onValueChange={(v) => {
              setName(v);
              setErrors({});
            }}
            placeholder={t("player.name.placeholder")}
            aria-invalid={!!errors.name}
            onKeyDown={(e) => {
              // Enter picks a highlighted suggestion; with none left it adds the typed name.
              if (e.key === "Enter" && matches.length === 0) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {matches.length > 0 && (
            <CommandList>
              <CommandGroup heading={t("add.recent")}>
                {matches.map((m) => (
                  <CommandItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => {
                      setName(m.name);
                      if (m.riot) setRiot(m.riot);
                    }}
                  >
                    <span className="text-name">{m.name}</span>
                    <span className="ml-auto text-meta text-muted-foreground">{now ? ago(m.at, now, t) : ""}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
        <FieldError id="name-error">{errors.name}</FieldError>
      </div>
      {required && <RiotField value={riot} onChange={setRiot} error={errors.riot} required />}
      <FieldError id="form-error">{errors.form}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" className="max-md:h-11" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="lg" className="max-md:h-11" disabled={busy || !canWrite}>
          {t("action.add")}
        </Button>
      </div>
    </form>
  );
}

export function EditPlayerDialog() {
  const { t } = useT();
  const ui = useUi();
  return (
    <ResponsiveDialog open={!!ui.editing} onOpenChange={(o) => !o && ui.setEditing(null)} title={t("edit.title")}>
      {ui.editing && <EditPlayerForm key={ui.editing.id} />}
    </ResponsiveDialog>
  );
}

function EditPlayerForm() {
  const { t } = useT();
  const ui = useUi();
  const p = ui.editing!;
  const act = useAct();
  const canWrite = useCanWrite();
  const fieldErrors = useFieldErrors();
  const { lookupRank } = useServerActions();
  const channelId = useQueue((v) => v.channel.id);
  const required = useQueue((v) => v.settings.require_riot_id);
  const riotEnabled = useQueue((v) => v.settings.riot_enabled);
  const [name, setName] = useState(p.kick_username);
  const [riot, setRiot] = useState(p.riot_id ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = name.trim();
    const r = riot.trim().replace(/\s+/g, " ");
    const next: Errors = {};
    if (!NAME.test(n)) next.name = t("player.name.invalid");
    if ((required && !r) || (r && !RIOT_ID.test(r))) next.riot = t("error.queue.riot_required");
    setErrors(next);
    if (next.name || next.riot) return;
    setBusy(true);
    const res = await act(
      "update_player",
      { p_player: p.id, p_kick_username: n, p_riot_id: r || null },
      { done: "done.edit", vars: { name: n }, silent: true },
    );
    setBusy(false);
    if (isError(res)) return setErrors(fieldErrors(res));
    if (r && r !== p.riot_id && riotEnabled) void lookupRank(channelId, r);
    ui.setEditing(null);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">{t("player.name")}</Label>
        <Input
          id="edit-name"
          className="h-9 max-md:h-11"
          value={name}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "edit-name-error" : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldError id="edit-name-error">{errors.name}</FieldError>
      </div>
      <RiotField value={riot} onChange={setRiot} error={errors.riot} required={required} />
      <FieldError id="edit-form-error">{errors.form}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" className="max-md:h-11" onClick={() => ui.setEditing(null)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="lg" className="max-md:h-11" disabled={busy || !canWrite}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
