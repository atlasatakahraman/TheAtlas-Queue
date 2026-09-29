"use client";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, GripVertical, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Numerals } from "@/components/numerals";
import { Field, inputCls, SaveRow, Section, triggerCls } from "@/components/queue/settings-page";
import { useAct, useCanWrite, useErrorText, useQueue } from "@/components/queue/store";
import { Tip } from "@/components/tip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { LabelKey } from "@/lib/i18n";
import { isError } from "@/lib/queue-store";
import { db } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { OVERLAY_ANCHORS, type Overlay, type OverlayConfig } from "@/types/queue";

const MASK = "••••••••";
const url = (key: string) => `${window.location.origin}/overlay/${key}`;

// The channel's overlays, read by the owner through RLS (moderators never see a key). Read again
// on every change to the channel, which create, rotate, delete and Undo all are.
function useOverlays() {
  const channel = useQueue((v) => v.channel.id);
  const v = useQueue((x) => x.v);
  const [list, setList] = useState<Overlay[] | null>(null);
  useEffect(() => {
    let live = true;
    void db()
      .from("overlays")
      .select("id, channel_id, key, name, config, created_at, updated_at")
      .eq("channel_id", channel)
      .is("deleted_at", null)
      .order("created_at")
      .then(({ data }) => live && data && setList(data as Overlay[]));
    return () => {
      live = false;
    };
  }, [channel, v]);
  return list;
}

function copy(key: string, done: string) {
  void navigator.clipboard.writeText(url(key)).then(() => toast(done, { duration: 2000 }));
}

// Settings → Overlays (D29, D30; DESIGN.md § Overlays in Settings): the list, or one overlay's
// builder at /settings/overlays/<id>.
export function OverlaysSection() {
  const id = usePathname().split("/")[5];
  const list = useOverlays();
  const base = `/c/${useQueue((v) => v.channel.slug)}/settings/overlays`;
  const go = (to: string) => window.history.pushState(null, "", to);
  const open = id && list?.find((o) => o.id === id);
  if (id && list && !open) return <OverlayList list={list} base={base} go={go} gone />;
  if (open) return <Builder key={open.id} overlay={open} back={() => go(base)} />;
  return <OverlayList list={list} base={base} go={go} />;
}

function OverlayList({ list, base, go, gone }: { list: Overlay[] | null; base: string; go: (to: string) => void; gone?: boolean }) {
  const { t } = useT();
  const act = useAct();
  const errorText = useErrorText();
  const canWrite = useCanWrite();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState<Overlay | null>(null);

  async function add() {
    setBusy(true);
    const r = await act("create_overlay", { p_name: name }, { silent: true });
    setBusy(false);
    if (isError(r)) return setError(r.key === "network" ? t("error.network") : errorText(r));
    setName("");
    const created = (r as { overlay?: string }).overlay;
    if (created) go(`${base}/${created}`);
  }

  return (
    <Section title={t("settings.overlays")} hint={t("settings.overlays.hint")}>
      {gone && <p className="text-meta text-muted-foreground">{t("settings.overlays.gone")}</p>}
      {list === null ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-[3.875rem] w-full rounded-xl" />
          <Skeleton className="h-[3.875rem] w-full rounded-xl" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">{t("settings.overlays.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-row-edge bg-row px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-name">{o.name}</span>
                {/* The key is a secret: never on screen, so a stream never shows it. */}
                <span className="font-mono text-code text-muted-foreground">/overlay/{MASK}</span>
              </span>
              <span className="flex items-center">
                <Tip label={t("settings.overlays.copy")}>
                  <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("settings.overlays.copy")} onClick={() => copy(o.key, t("common.copied"))}>
                    <Copy aria-hidden />
                  </Button>
                </Tip>
                <Tip label={canWrite ? t("settings.overlays.rotate") : t("why.offline")}>
                  <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("settings.overlays.rotate")} disabled={!canWrite} onClick={() => setRotating(o)}>
                    <KeyRound aria-hidden />
                  </Button>
                </Tip>
                <Tip label={canWrite ? t("settings.overlays.delete") : t("why.offline")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground max-md:size-11"
                    aria-label={t("settings.overlays.delete")}
                    disabled={!canWrite}
                    onClick={() => void act("delete_overlay", { p_id: o.id }, { done: "done.delete_overlay", vars: { name: o.name } })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </Tip>
                <Button variant="outline" size="lg" className="ml-2 max-md:h-11" asChild>
                  <a
                    href={`${base}/${o.id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      go(`${base}/${o.id}`);
                    }}
                  >
                    <Pencil aria-hidden />
                    {t("settings.overlays.edit")}
                  </a>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Input
            aria-label={t("settings.overlays.name")}
            placeholder={t("settings.overlays.name.placeholder")}
            className={inputCls}
            maxLength={40}
            value={name}
            aria-invalid={!!error}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
          />
          {error && <p className="text-meta text-destructive">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="max-md:h-11" disabled={busy || !name.trim() || !canWrite}>
          <Plus aria-hidden />
          {t("settings.overlays.new")}
        </Button>
      </form>
      <RotateDialog overlay={rotating} onClose={() => setRotating(null)} />
    </Section>
  );
}

// A new key: the old link stops at once and nothing brings it back (ADR 0054), so it asks for the
// overlay's name, typed, rather than a click.
function RotateDialog({ overlay, onClose }: { overlay: Overlay | null; onClose: () => void }) {
  const { t } = useT();
  const act = useAct();
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(overlay);
  if (overlay && overlay !== shown) {
    setShown(overlay);
    setTyped("");
  }
  const ok = !!shown && typed.trim() === shown.name;
  return (
    <AlertDialog open={!!overlay} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings.overlays.rotate.title", { name: shown?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t("settings.overlays.rotate.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          aria-label={t("settings.overlays.rotate.type", { name: shown?.name ?? "" })}
          placeholder={shown?.name}
          className={inputCls}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            size="lg"
            variant="destructive"
            disabled={!ok}
            onClick={() => {
              if (shown) void act("rotate_overlay_key", { p_id: shown.id }, { done: "done.rotate_overlay_key", vars: { name: shown.name }, undoable: () => false });
              onClose();
            }}
          >
            {t("settings.overlays.rotate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const WIDGET_LABEL: Record<OverlayConfig["widgets"][number]["type"], LabelKey> = {
  teams: "settings.overlays.w.teams",
  score: "settings.overlays.w.score",
  reveal: "settings.overlays.w.reveal",
  queue: "settings.overlays.w.queue",
  last: "settings.overlays.w.last",
  wins: "settings.overlays.w.wins",
  respect: "settings.overlays.w.respect",
};

// One overlay's builder: the live preview over the controls (the Settings column is 44rem).
// Switches and selects save as they change, the name on Save (ADR 0033).
function Builder({ overlay, back }: { overlay: Overlay; back: () => void }) {
  const { t } = useT();
  const act = useAct();
  const errorText = useErrorText();
  const canWrite = useCanWrite();
  const [config, setConfig] = useState(overlay.config);
  const [name, setName] = useState(overlay.name);
  const [saved, setSaved] = useState(overlay.name);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<number | null>(null);

  const write = async (patch: { p_name?: string; p_config?: OverlayConfig }) => {
    setState("saving");
    setErrors({});
    const r = await act("update_overlay", { p_id: overlay.id, p_name: patch.p_name ?? null, p_config: patch.p_config ?? null }, { silent: true });
    if (isError(r)) {
      setState("idle");
      const field = typeof r.detail.field === "string" ? r.detail.field : "form";
      setErrors({ [field === "name" ? "name" : "form"]: r.key === "network" ? t("error.network") : errorText(r) });
      return false;
    }
    setState("saved");
    return true;
  };
  const put = async (next: OverlayConfig) => {
    const before = config;
    setConfig(next);
    if (!(await write({ p_config: next }))) setConfig(before);
  };
  const set = <K extends keyof OverlayConfig>(k: K, v: OverlayConfig[K]) => void put({ ...config, [k]: v });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= config.widgets.length || from === to) return;
    const w = [...config.widgets];
    w.splice(to, 0, ...w.splice(from, 1));
    void put({ ...config, widgets: w });
  };
  const saveName = async () => {
    if (name.trim() === saved) return;
    if (await write({ p_name: name })) setSaved(name.trim());
  };

  const select = <K extends keyof OverlayConfig>(k: K, label: LabelKey, options: { value: OverlayConfig[K]; label: string }[]) => (
    <Field label={t(label)}>
      <Select value={String(config[k])} onValueChange={(v) => set(k, options.find((o) => String(o.value) === v)!.value)} disabled={!canWrite}>
        <SelectTrigger className={triggerCls}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const boards = config.widgets.some((w) => w.on && (w.type === "wins" || w.type === "respect"));

  return (
    <Section title={overlay.name} onEnter={() => void saveName()}>
      <Button variant="ghost" size="lg" className="-mt-2 -ml-3 w-fit max-md:h-11" onClick={back}>
        <ArrowLeft aria-hidden />
        {t("settings.overlays")}
      </Button>
      <Preview overlayKey={overlay.key} solid={config.background === "solid"} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-mono text-code text-muted-foreground">/overlay/{MASK}</span>
        <Button variant="outline" size="lg" className="max-md:h-11" onClick={() => copy(overlay.key, t("common.copied"))}>
          <Copy aria-hidden />
          {t("settings.overlays.copy")}
        </Button>
      </div>
      <p className="-mt-2 text-meta text-muted-foreground"><Numerals text={t("settings.overlays.obs")} /></p>
      <Field id="overlay-name" label={t("settings.overlays.name")} error={errors.name}>
        <Input
          id="overlay-name"
          className={inputCls}
          maxLength={40}
          value={name}
          aria-invalid={!!errors.name}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
            setErrors({});
          }}
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("settings.overlays.widgets")}</span>
        {/* The order they stand in: drag by the handle, or ↑ ↓ by keyboard and touch. */}
        <ol className="flex flex-col gap-1.5">
          {config.widgets.map((w, i) => (
            <li
              key={w.type}
              onDragOver={(e) => drag !== null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
              }}
              className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-row-edge bg-background py-1.5 pr-3 pl-1",
                drag === i && "opacity-50",
              )}
            >
              <span
                draggable={canWrite}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDrag(i);
                }}
                onDragEnd={() => setDrag(null)}
                aria-hidden
                className="flex size-8 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </span>
              <label htmlFor={`w-${w.type}`} className="truncate text-control">
                {t(WIDGET_LABEL[w.type])}
              </label>
              <span className="flex">
                <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("settings.overlays.up")} disabled={!canWrite || i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="max-md:size-11"
                  aria-label={t("settings.overlays.down")}
                  disabled={!canWrite || i === config.widgets.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
              </span>
              <Switch
                id={`w-${w.type}`}
                checked={w.on}
                disabled={!canWrite}
                onCheckedChange={(on) => void put({ ...config, widgets: config.widgets.map((x) => (x.type === w.type ? { ...x, on } : x)) })}
              />
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {select("anchor", "settings.overlays.anchor", OVERLAY_ANCHORS.map((a) => ({ value: a, label: t(`settings.overlays.anchor.${a}`) })))}
        {select("size", "settings.overlays.size", (["s", "m", "l"] as const).map((s) => ({ value: s, label: t(`settings.overlays.size.${s}`) })))}
        {select("theme", "settings.overlays.theme", [
          { value: "ink", label: t("settings.overlays.theme.ink") },
          { value: "paper", label: t("settings.overlays.theme.paper") },
        ])}
        {select("background", "settings.overlays.background", [
          { value: "transparent", label: t("settings.overlays.background.transparent") },
          { value: "solid", label: t("settings.overlays.background.solid") },
        ])}
        {/* Language: the stream language chat replies use (Labels), unless this overlay says. */}
        <Field label={t("settings.overlays.lang")}>
          <Select value={config.lang ?? "stream"} onValueChange={(v) => set("lang", v === "stream" ? null : (v as "en" | "tr"))} disabled={!canWrite}>
            <SelectTrigger className={triggerCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="stream">{t("settings.overlays.lang.stream")}</SelectItem>
              <SelectItem value="en">{t("lang.name.en")}</SelectItem>
              <SelectItem value="tr">{t("lang.name.tr")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {config.widgets.some((w) => w.on && w.type === "queue") &&
          select("queue_rows", "settings.overlays.queue_rows", ([5, 10, 15] as const).map((n) => ({ value: n, label: String(n) })))}
        {boards && select("board_rows", "settings.overlays.board_rows", ([3, 5, 10] as const).map((n) => ({ value: n, label: String(n) })))}
        {boards &&
          select("min_games", "settings.overlays.min_games", ([0, 1, 3, 5, 10, 20] as const).map((n) => ({ value: n, label: String(n) })))}
        {boards &&
          select("board_period", "settings.overlays.board_period", [
            { value: "stream", label: t("settings.overlays.board_period.stream") },
            { value: "all", label: t("settings.overlays.board_period.all") },
          ])}
      </div>
      <SaveRow s={{ dirty: name.trim() !== saved, save: saveName, state, errors }} />
    </Section>
  );
}

// The overlay itself in a frame, scaled from 1920×1080 to the column's width: the preview is the
// real page, live through the same ping. Transparent overlays sit on a checkerboard.
function Preview({ overlayKey, solid }: { overlayKey: string; solid: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const measure = useCallback(() => box.current && setScale(box.current.clientWidth / 1920), []);
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div
      ref={box}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-row-edge",
        !solid && "bg-[repeating-conic-gradient(var(--muted)_0_25%,var(--background)_0_50%)] bg-size-[24px_24px]",
      )}
    >
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {scale > 0 && (
        <iframe
          src={`/overlay/${overlayKey}`}
          title="Overlay"
          tabIndex={-1}
          onLoad={() => setLoaded(true)}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 [color-scheme:normal]"
          style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}
