"use client";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useAct, useCanWrite, useErrorText, useQueue } from "@/components/queue/store";
import { type SanctionDraft, useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isError } from "@/lib/queue-store";

const BAN_DAYS = ["1", "7", "30", "permanent"] as const;

// Warn, punish or ban from the row menu. The reason stays on the dashboard: /watch shows names
// and kinds only (spec § Security → Public payload).
export function SanctionDialog() {
  const { t } = useT();
  const ui = useUi();
  const s = ui.sanction;
  return (
    <ResponsiveDialog
      open={!!s}
      onOpenChange={(o) => !o && ui.setSanction(null)}
      title={s ? t(`sanction.title.${s.kind}`, { name: s.name }) : ""}
      description={t("sanction.private")}
    >
      {s && <SanctionForm key={`${s.kind}:${s.name}`} draft={s} onDone={() => ui.setSanction(null)} />}
    </ResponsiveDialog>
  );
}

function SanctionForm({ draft, onDone }: { draft: SanctionDraft; onDone: () => void }) {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const errorText = useErrorText();
  const respect = useQueue((v) => v.respect[draft.name.toLowerCase()]);
  const [reason, setReason] = useState("");
  const [unit, setUnit] = useState<"games" | "minutes">("games");
  const [amount, setAmount] = useState("1");
  const [days, setDays] = useState<(typeof BAN_DAYS)[number]>("7");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const n = Number(amount);
  const amountOk = Number.isInteger(n) && (unit === "games" ? n >= 1 && n <= 10 : n >= 1 && n <= 525600);

  async function submit() {
    if (draft.kind === "punish" && !amountOk) return setError(t(unit === "games" ? "sanction.games.invalid" : "sanction.minutes.invalid"));
    setBusy(true);
    const base = { p_kick_username: draft.name, p_reason: reason.trim() };
    const res =
      draft.kind === "warn"
        ? await act("warn", base, { done: "done.warn", vars: { name: draft.name }, silent: true })
        : draft.kind === "punish"
          ? await act(
              "punish",
              { ...base, p_games: unit === "games" ? n : null, p_minutes: unit === "minutes" ? n : null },
              { done: "done.punish", vars: { name: draft.name }, silent: true },
            )
          : await act(
              "ban",
              { ...base, p_days: days === "permanent" ? null : Number(days) },
              { done: "done.ban", vars: { name: draft.name }, silent: true },
            );
    setBusy(false);
    if (isError(res)) return setError(res.key === "network" ? t("error.network") : errorText(res));
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {respect !== undefined && <p className="text-meta text-muted-foreground">{t("sanction.respect", { n: respect })}</p>}
      {draft.kind === "punish" && (
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sanction-amount">{t("sanction.for")}</Label>
            <Input
              id="sanction-amount"
              inputMode="numeric"
              className="h-9 tabular-nums max-md:h-11"
              value={amount}
              aria-invalid={!!error}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(undefined);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("sanction.unit")}</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as "games" | "minutes")}>
              <SelectTrigger className="h-9! w-full max-md:h-11!">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="games">{t("sanction.unit.games")}</SelectItem>
                <SelectItem value="minutes">{t("sanction.unit.minutes")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {draft.kind === "ban" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("sanction.length")}</Label>
          <Select value={days} onValueChange={(v) => setDays(v as (typeof BAN_DAYS)[number])}>
            <SelectTrigger className="h-9! w-full max-md:h-11!">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {BAN_DAYS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d === "permanent" ? t("sanction.permanent") : d === "1" ? t("sanction.day") : t("sanction.days", { n: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sanction-reason">{t("sanction.reason")}</Label>
        <Textarea
          id="sanction-reason"
          maxLength={200}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("sanction.reason.placeholder")}
        />
      </div>
      {error && <p className="text-meta text-destructive selection:bg-destructive selection:text-background">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" className="max-md:h-11" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          size="lg"
          variant={draft.kind === "ban" ? "destructive" : "default"}
          className="max-md:h-11"
          disabled={busy || !canWrite}
        >
          {t(`menu.${draft.kind}.confirm`)}
        </Button>
      </div>
    </form>
  );
}

const KICK_NAME = /^[A-Za-z0-9_-]{1,40}$/;

// Moderation → New action (August's "Yeni İşlem"): warn, punish or ban someone who is not in the
// queue, by their Kick name. It hands over to the same form the row menu opens.
export function NewSanctionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  function go(kind: SanctionDraft["kind"]) {
    const n = name.trim().replace(/^@/, "");
    if (!KICK_NAME.test(n)) return setError(t("mod.new.invalid"));
    onOpenChange(false);
    setName("");
    setError(null);
    ui.setSanction({ name: n, kind });
  }
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("mod.new.title")} description={t("mod.new.hint")}>
      <form className="flex flex-col gap-4" onSubmit={(e) => (e.preventDefault(), go("warn"))}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-sanction-name">{t("mod.new.name")}</Label>
          <Input
            id="new-sanction-name"
            value={name}
            autoComplete="off"
            aria-invalid={!!error}
            onChange={(e) => (setName(e.target.value), setError(null))}
            className="h-9 max-md:h-11"
          />
          {error && <p className="text-meta text-destructive">{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-md:grid max-md:grid-cols-3">
          <Button type="submit" variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite}>
            {t("menu.warn.confirm")}
          </Button>
          <Button type="button" variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite} onClick={() => go("punish")}>
            {t("menu.punish.confirm")}
          </Button>
          <Button type="button" variant="destructive" size="lg" className="max-md:h-11" disabled={!canWrite} onClick={() => go("ban")}>
            {t("menu.ban.confirm")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
