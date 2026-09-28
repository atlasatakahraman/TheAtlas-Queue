"use client";
import { FastForward, type LucideIcon, RotateCcw, Undo2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import { PlayerAvatar, RankText, usePlayerActions, useTeamRoom } from "@/components/queue/player-row";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { LandingName, pickPool, revealOrder, useDrawActions, usePick, useRevealMotion } from "@/components/queue/teams-tab";
import { useMotion } from "@/components/prefs";
import { useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";
import type { DrawEntry, Player } from "@/types/queue";

// A fresh draw from anyone (DESIGN.md § The draw reveal): a team draw brings the Teams tab
// forward, where the rosters land; a pick opens its dialog. Without motion both are simply shown.
export function RevealDriver() {
  const store = useStore();
  const ui = useUi();
  const motion = useRevealMotion();
  const { setTab } = ui;
  useEffect(
    () =>
      store.subscribe(() => {
        const r = store.get().reveal;
        if (r?.kind !== "teams") return;
        if (!motion) store.clearReveal();
        else setTab("teams");
      }),
    [store, motion, setTab],
  );
  return <PickDialog />;
}

function PickDialog() {
  const { t } = useT();
  const store = useStore();
  const reveal = useQueue((v) => v.reveal);
  const pick = reveal?.kind === "pick" ? reveal : null;
  // The last pick stays in the dialog while it animates out, so it does not close empty.
  const [last, setLast] = useState(pick);
  if (pick && pick !== last) setLast(pick);
  const shown = pick ?? last;
  return (
    <ResponsiveDialog open={!!pick} onOpenChange={(o) => !o && store.clearReveal()} title={t("pick.title")}>
      {shown && <PickBody key={shown.id} picked={shown.result.picked ?? []} />}
    </ResponsiveDialog>
  );
}

type Staged = "cards" | "list" | "wheel";
const STAGED: readonly string[] = ["cards", "list", "wheel"];
// A reveal holds on its picked name this long before the next one starts or the list shows.
const HOLD = 600;

// One pick: with Cards, List or Wheel each name plays its reveal in turn (D22, DESIGN.md § The
// draw reveal), joining the list when it stops; otherwise the names land as the team draw's do.
function PickBody({ picked }: { picked: DrawEntry[] }) {
  const { t } = useT();
  const act = useAct();
  const store = useStore();
  const canWrite = useCanWrite();
  const room = useTeamRoom();
  const players = useQueue((v) => v.players);
  const setting = useQueue((v) => v.settings.draw_reveal);
  const typing = useRevealMotion();
  const motion = useMotion();
  const staged = motion && STAGED.includes(setting) ? (setting as Staged) : null;
  const { source } = usePick();
  const { pick: pickAgain } = useDrawActions();
  // The pool the reveal runs over: this browser's pick source as the pick found it, the picked
  // names included. ponytail: a draw row does not record its source, so another member's pick
  // from a different source shows this browser's pool; where it stops is still the server's.
  const [pool] = useState(() => {
    const view = store.get();
    const ids = new Set(picked.map((e) => e.id));
    const rest = pickPool(view, source).filter((p) => !ids.has(p.id));
    return [...rest, ...picked.flatMap((e) => view.players.find((p) => p.id === e.id) ?? [])];
  });
  const [step, setStep] = useState(staged ? 0 : picked.length);
  const playing = step < picked.length;
  const order = useMemo(() => revealOrder([picked]), [picked]);
  // The picked players as they are now: a row acted on shows its new state, a removed one goes.
  const live = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const shown = order.slice(0, step);
  const here = shown.flatMap((o) => live.get(o.entry.id) ?? []);
  const again = useRef<HTMLButtonElement>(null);
  const next = useCallback(() => setStep((n) => n + 1), []);

  // Enter or Space skips a reveal that is playing (August); once it has stopped, focus sits on
  // Pick again, so the same keys pick again.
  useEffect(() => {
    if (!playing) return void again.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      setStep(picked.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, picked.length]);

  // All to Team N (owner, 2026-09-27): one write, one Undo; those already there stay.
  const allTo = (n: 1 | 2) => {
    const ids = here.filter((p) => !(p.status === "playing" && p.team === n)).map((p) => p.id);
    return {
      ids,
      run: () =>
        act("move_players", { p_ids: ids, p_team: n }, {
          optimistic: { ids, patch: (x) => ({ ...x, status: "playing", team: n }) },
          done: "done.move_all",
          vars: { n: ids.length, team: t(`team.${n}`) },
        }),
    };
  };
  const taken = new Set(picked.slice(0, step).map((e) => e.id));
  return (
    <>
      {playing && staged && (
        <Stage key={step} style={staged} pool={pool.filter((p) => !taken.has(p.id))} winner={picked[step].id} onDone={next} />
      )}
      {shown.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {shown.map((o) => {
            const p = live.get(o.entry.id);
            return (
              <LandingName key={o.entry.id} entry={o.entry} at={typing ? o.at : 0} typed={!staged}>
                {p ? <PickedActions p={p} /> : <span className="ml-auto text-meta text-muted-foreground">{t("pick.removed")}</span>}
              </LandingName>
            );
          })}
        </div>
      )}
      {here.length > 1 && !playing && (
        <div className="grid grid-cols-2 gap-2">
          {([1, 2] as const).map((n) => {
            const all = allTo(n);
            return (
              <Button
                key={n}
                variant="outline"
                size="lg"
                className={cn("max-md:h-11", n === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2")}
                disabled={!canWrite || all.ids.length === 0 || all.ids.length > room(n)}
                onClick={() => void all.run()}
              >
                <Users aria-hidden />
                {t("pick.all_to", { team: t(`team.${n}`) })}
              </Button>
            );
          })}
        </div>
      )}
      <div className="flex justify-end">
        {playing ? (
          <Button variant="outline" size="lg" className="max-md:h-11" onClick={() => setStep(picked.length)}>
            <FastForward aria-hidden />
            {t("pick.skip")}
          </Button>
        ) : (
          <Button
            ref={again}
            variant="outline"
            size="lg"
            className="max-md:h-11"
            disabled={!canWrite}
            onClick={() => void pickAgain(picked.length, source)}
          >
            <RotateCcw aria-hidden />
            {t("pick.again")}
          </Button>
        )}
      </div>
    </>
  );
}

type StageProps = { pool: Player[]; win: Player; finish: () => void };

// One name's reveal. Every style stops on `winner` (the server's pick), holds, then calls onDone.
function Stage({ style, pool, winner, onDone }: { style: Staged; pool: Player[]; winner: string; onDone: () => void }) {
  const finish = useCallback(() => void setTimeout(onDone, HOLD), [onDone]);
  const win = pool.find((p) => p.id === winner);
  if (!win) return null;
  if (style === "cards") return <CardsStage pool={pool} win={win} finish={finish} />;
  if (style === "list") return <ListStage pool={pool} win={win} finish={finish} />;
  return <WheelStage pool={pool} win={win} finish={finish} />;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Face({ p }: { p: Player }) {
  return (
    <>
      <PlayerAvatar player={p} />
      <span className="min-w-0 truncate text-name">{p.kick_username}</span>
      <RankText player={p} className="ml-auto shrink-0" />
    </>
  );
}

// Cards (August's classic): one card flicks through the pool, slowing over 14 steps (gaps 50 to
// 232ms, about 2 s), and stops on the pick with a gold edge.
function CardsStage({ pool, win, finish }: StageProps) {
  const [face, setFace] = useState(pool[0]);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const seq = shuffle(pool);
    let step = 0;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (step === 14) {
        setFace(win);
        setStopped(true);
        return finish();
      }
      setFace(seq[step % seq.length]);
      id = setTimeout(tick, 50 + 14 * step++);
    };
    tick();
    return () => clearTimeout(id);
  }, [pool, win, finish]);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border-2 bg-row px-4 py-4 transition-colors duration-200",
        stopped ? "border-brand" : "border-row-edge",
      )}
    >
      <Face p={face} />
    </div>
  );
}

// List: a strip scrolls behind a one-row gold frame and eases out (cubic, 2.8 s) on the pick.
const ROW = 56;
function ListStage({ pool, win, finish }: StageProps) {
  const [strip] = useState(() => [
    ...Array.from({ length: Math.max(pool.length * 3, 15) - 1 }, () => pool[Math.floor(Math.random() * pool.length)]),
    win,
  ]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const start = performance.now();
    const dist = (strip.length - 1) * ROW;
    let id = 0;
    const frame = (now: number) => {
      const k = Math.min((now - start) / 2800, 1);
      if (ref.current) ref.current.style.transform = `translateY(-${(1 - (1 - k) ** 3) * dist}px)`;
      if (k < 1) id = requestAnimationFrame(frame);
      else finish();
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [strip, finish]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-row-edge bg-row" style={{ height: ROW }}>
      <div ref={ref} className="will-change-transform">
        {strip.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4" style={{ height: ROW }}>
            <Face p={p} />
          </div>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-xl border-2 border-brand" />
    </div>
  );
}

// Wheel (Çarkıfelek): wedges alternating row and muted, the pointer a gold triangle on the right.
// 8 to 11 turns easing out on a 7th-power curve over 6 s; the picked wedge then fills gold. No
// hub: the wedges meet in the middle (no dots, owner rule).
const R = 140;
const polar = (deg: number, r = R) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
function WheelStage({ pool, win, finish }: StageProps) {
  const [wedges] = useState(() => shuffle(pool));
  const [turns] = useState(() => 8 + Math.floor(Math.random() * 4));
  const [stopped, setStopped] = useState(false);
  const ref = useRef<SVGGElement>(null);
  const n = wedges.length;
  const seg = 360 / n;
  const at = wedges.findIndex((p) => p.id === win.id);
  useEffect(() => {
    const target = turns * 360 + ((360 - (at + 0.5) * seg) % 360);
    const start = performance.now();
    let id = 0;
    const frame = (now: number) => {
      const k = Math.min((now - start) / 6000, 1);
      if (ref.current) ref.current.style.transform = `rotate(${(1 - (1 - k) ** 7) * target}deg)`;
      if (k < 1) id = requestAnimationFrame(frame);
      else {
        setStopped(true);
        finish();
      }
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [at, seg, turns, finish]);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-72">
      <svg viewBox="-150 -150 300 300" className="size-full" role="img" aria-label={win.kick_username}>
        <g ref={ref}>
          {wedges.map((p, i) => {
            const [x1, y1] = polar(i * seg);
            const [x2, y2] = polar((i + 1) * seg);
            const mid = (i + 0.5) * seg;
            const [lx, ly] = polar(mid, R * 0.62);
            const won = stopped && i === at;
            const name = p.kick_username.length > 10 ? `${p.kick_username.slice(0, 9)}…` : p.kick_username;
            return (
              <g key={p.id}>
                {n === 1 ? (
                  <circle r={R} className={won ? "fill-brand" : "fill-row"} />
                ) : (
                  <path
                    d={`M0 0L${x1} ${y1}A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2}Z`}
                    className={cn("stroke-row-edge transition-colors duration-200", won ? "fill-brand" : i % 2 ? "fill-muted" : "fill-row")}
                  />
                )}
                <text
                  x={lx}
                  y={ly}
                  transform={n === 1 ? undefined : `rotate(${mid} ${lx} ${ly})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn("text-[11px] font-medium", won ? "fill-background" : "fill-foreground")}
                >
                  {name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <span
        aria-hidden
        className="absolute top-1/2 -right-1 size-0 -translate-y-1/2 border-y-[10px] border-r-[16px] border-y-transparent border-r-brand"
      />
    </div>
  );
}

// One picked name's moves: either team, back to waiting, out of the queue. A move that cannot
// happen is disabled, never hidden (owner, 2026-09-27).
function PickedActions({ p }: { p: Player }) {
  const { t } = useT();
  const a = usePlayerActions(p);
  const canWrite = useCanWrite();
  const room = useTeamRoom();
  const moves: { label: string; icon: LucideIcon; tone: string; run: () => unknown; off: boolean }[] = [
    ...([1, 2] as const).map((n) => ({
      label: t("menu.move_to", { team: t(`team.${n}`) }),
      icon: UserPlus,
      tone: n === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2",
      run: () => a.moveTo(n),
      off: p.team === n || room(n) < 1,
    })),
    { label: t("menu.to_waiting"), icon: Undo2, tone: "text-muted-foreground", run: a.toWaiting, off: p.status !== "playing" },
    { label: t("menu.remove"), icon: X, tone: "text-muted-foreground", run: a.remove, off: false },
  ];
  return (
    <span className="ml-auto flex shrink-0 items-center">
      {moves.map(({ label, icon: Icon, tone, run, off }) => (
        <Button
          key={label}
          variant="ghost"
          size="icon"
          className={cn("max-md:size-11", tone)}
          disabled={!canWrite || off}
          aria-label={label}
          title={label}
          onClick={() => void run()}
        >
          <Icon aria-hidden />
        </Button>
      ))}
    </span>
  );
}
