"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Typed } from "@/components/prefs";
import { REVEAL } from "@/components/queue/reveal-order";
import { BREAK, ShieldBreak } from "@/components/queue/shield-break";
import { PlayerAvatar, RankText } from "@/components/queue/team-card";
import { cn } from "@/lib/utils";
import type { Player } from "@/types/queue";

// A pick's reveal stages (DESIGN.md § The draw reveal), in a module of their own with no store so
// /watch plays them too (P13). The dashboard's Picked dialog and /watch's feed them plain data.

export type StagePlayer = Pick<Player, "id" | "kick_username" | "riot_id" | "rank">;
// A protected player the pick landed on, and who took their slot (null: nobody could) (P8).
export type Save = { protectedPlayer: StagePlayer; standin: StagePlayer | null };
export type Staged = "cards" | "list" | "wheel";
export const STAGED: readonly string[] = ["cards", "list", "wheel"];
// A reveal holds on its picked name this long before the next one starts or the list shows.
export const HOLD = 600;

type StageProps = { pool: StagePlayer[]; win: StagePlayer | null; save?: Save; finish: () => void };

// One slot's reveal. Without a save it stops on `winner` (the server's pick). With one (P8) it
// stops on the protected player, the shield breaks, and it is kicked on to the stand-in — or, with
// no stand-in, it stays and nobody takes the slot. Then it holds and calls onDone.
// Its inputs are fixed at mount (the parent keys it per slot): the parent re-renders on every
// realtime event, and a new pool or save would restart the spin.
export function Stage({ style, pool, winner, save, onDone }: { style: Staged; pool: StagePlayer[]; winner: string | null; save?: Save; onDone: () => void }) {
  const finish = useCallback(() => void setTimeout(onDone, HOLD), [onDone]);
  const [fixed] = useState(() => ({ pool, save, win: pool.find((p) => p.id === winner) ?? null }));
  if (!fixed.win && !fixed.save) return null;
  const props = { ...fixed, finish };
  if (style === "cards") return <CardsStage {...props} />;
  if (style === "list") return <ListStage {...props} />;
  return <WheelStage {...props} />;
}

// The reveal's pool always holds the players its slot names, even when this browser's pick
// source differs from the one the pick used (Review Focus 1).
export function poolWith(pool: StagePlayer[], ...extra: (StagePlayer | null | undefined)[]): StagePlayer[] {
  const ids = new Set(pool.map((p) => p.id));
  return [...pool, ...extra.filter((p): p is StagePlayer => !!p && !ids.has(p.id))];
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Face({ p }: { p: StagePlayer }) {
  return (
    <>
      <PlayerAvatar player={p} />
      <span className="min-w-0 truncate text-name">{p.kick_username}</span>
      <RankText player={p} className="ml-auto shrink-0" />
    </>
  );
}

// The beats after a near miss stops (P8): the shield mounts SLAM_AT after the stop.
const SLAM_AT = 380;
function useBreak(stopped: boolean, save: Save | undefined, onKick: () => void, onSettle: () => void) {
  const [breaking, setBreaking] = useState(false);
  useEffect(() => {
    if (!stopped || !save) return;
    const ids = [
      setTimeout(() => setBreaking(true), SLAM_AT),
      setTimeout(onKick, SLAM_AT + BREAK.split),
      setTimeout(onSettle, SLAM_AT + (save.standin ? BREAK.settle : BREAK.done)),
    ];
    return () => ids.forEach(clearTimeout);
  }, [stopped, save, onKick, onSettle]);
  return breaking;
}

// Cards (August's classic): one card flicks through the pool, slowing over 14 steps (gaps 50 to
// 232ms, about 2 s), and stops on the pick with a gold edge. A near miss stops on the protected
// player, breaks, and flips to the stand-in.
function CardsStage({ pool, win, save, finish }: StageProps) {
  const first = save ? save.protectedPlayer : win!;
  const [face, setFace] = useState(pool[0] ?? first);
  const [stopped, setStopped] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [gold, setGold] = useState(false);
  useEffect(() => {
    const seq = shuffle(pool);
    let step = 0;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (step === 14 || !seq.length) {
        setFace(first);
        setStopped(true);
        if (!save) {
          setGold(true);
          finish();
        }
        return;
      }
      setFace(seq[step % seq.length]);
      id = setTimeout(tick, 50 + 14 * step++);
    };
    tick();
    return () => clearTimeout(id);
  }, [pool, first, save, finish]);
  const kick = useCallback(() => {
    if (save?.standin) {
      setFace(save.standin);
      setFlipped(true);
    }
  }, [save]);
  const settle = useCallback(() => {
    setGold(!!save?.standin);
    finish();
  }, [save, finish]);
  const breaking = useBreak(stopped, save, kick, settle);
  return (
    <div className="relative">
      <div
        key={flipped ? "standin" : "first"}
        className={cn(
          "flex items-center gap-3 rounded-xl border-2 bg-row px-4 py-4 transition-colors duration-200",
          gold ? "border-brand" : "border-row-edge",
          flipped && "animate-[sb-flip_320ms_cubic-bezier(.3,1.3,.5,1)_both]",
        )}
      >
        <Face p={face} />
      </div>
      {breaking && <ShieldBreak />}
    </div>
  );
}

// List: a strip scrolls behind a one-row gold frame and eases out (cubic, 2.8 s) on the pick. A
// near miss eases out one row short, on the protected player; the break kicks it on a row.
const ROW = 56;
function ListStage({ pool, win, save, finish }: StageProps) {
  const [strip] = useState(() => {
    const tail = save ? [save.protectedPlayer, ...(save.standin ? [save.standin] : [])] : [win!];
    const from = pool.length ? pool : tail;
    return [...Array.from({ length: Math.max(from.length * 3, 15) - 1 }, () => from[Math.floor(Math.random() * from.length)]), ...tail];
  });
  const stopAt = (save ? strip.length - (save.standin ? 2 : 1) : strip.length - 1) * ROW;
  const ref = useRef<HTMLDivElement>(null);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const frame = (now: number) => {
      const k = Math.min((now - start) / 2800, 1);
      if (ref.current) ref.current.style.transform = `translateY(-${(1 - (1 - k) ** 3) * stopAt}px)`;
      if (k < 1) id = requestAnimationFrame(frame);
      else if (save) setStopped(true);
      else finish();
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [stopAt, save, finish]);
  const kick = useCallback(() => {
    if (!save?.standin || !ref.current) return;
    const y = (d: number) => `translateY(-${stopAt + d * ROW}px)`;
    ref.current.animate([{ transform: y(0) }, { transform: y(1.14), offset: 0.55 }, { transform: y(0.96), offset: 0.78 }, { transform: y(1) }],
      { duration: 560, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
  }, [save, stopAt]);
  const breaking = useBreak(stopped, save, kick, finish);
  return (
    <div className="relative">
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
      {breaking && <ShieldBreak />}
    </div>
  );
}

// Wheel (Çarkıfelek): wedges alternating row and muted, the pointer a gold triangle on the right.
// 8 to 11 turns easing out on a 7th-power curve over 6 s; the picked wedge then fills gold. No
// hub: the wedges meet in the middle (no dots, owner rule).
const R = 140;
const polar = (deg: number, r = R) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
function WheelStage({ pool, win, save, finish }: StageProps) {
  // A near miss (P8): the stand-in sits at index p − 1, the wedge the pointer meets next as the
  // rotation grows, so the kick of one segment lands on them.
  const [wedges] = useState(() => {
    if (!save) return shuffle(pool);
    const pair = [save.standin, save.protectedPlayer].filter((p): p is StagePlayer => !!p);
    const rest = shuffle(pool.filter((p) => !pair.some((q) => q.id === p.id)));
    const at = Math.floor(Math.random() * (rest.length + 1));
    return [...rest.slice(0, at), ...pair, ...rest.slice(at)];
  });
  const [turns] = useState(() => 8 + Math.floor(Math.random() * 4));
  const [stopped, setStopped] = useState(false);
  const [won, setWon] = useState(false);
  const ref = useRef<SVGGElement>(null);
  const n = wedges.length;
  const seg = 360 / n;
  const at = wedges.findIndex((p) => p.id === (save ? save.protectedPlayer.id : win!.id));
  // The wedge that ends gold: the pick, the stand-in (always at − 1, see above), or none.
  const winIdx: number | null = save ? (save.standin ? at - 1 : null) : at;
  const target = turns * 360 + ((360 - (at + 0.5) * seg) % 360);
  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const frame = (now: number) => {
      const k = Math.min((now - start) / 6000, 1);
      if (ref.current) ref.current.style.transform = `rotate(${(1 - (1 - k) ** 7) * target}deg)`;
      if (k < 1) id = requestAnimationFrame(frame);
      else {
        setStopped(true);
        if (!save) {
          setWon(true);
          finish();
        }
      }
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [target, save, finish]);
  const kick = useCallback(() => {
    if (!save?.standin || !ref.current) return;
    const r = (d: number) => `rotate(${target + d * seg}deg)`;
    ref.current.animate([{ transform: r(0) }, { transform: r(1.14), offset: 0.55 }, { transform: r(0.96), offset: 0.78 }, { transform: r(1) }],
      { duration: 560, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" });
  }, [save, target, seg]);
  const settle = useCallback(() => {
    setWon(!!save?.standin);
    finish();
  }, [save, finish]);
  const breaking = useBreak(stopped, save, kick, settle);
  return (
    <div className="relative">
      <div className="relative mx-auto aspect-square w-full max-w-72">
        <svg viewBox="-150 -150 300 300" className="size-full" role="img" aria-label={wedges[winIdx ?? at].kick_username}>
          <g ref={ref}>
            {wedges.map((p, i) => {
              const [x1, y1] = polar(i * seg);
              const [x2, y2] = polar((i + 1) * seg);
              const mid = (i + 0.5) * seg;
              const [lx, ly] = polar(mid, R * 0.62);
              const gold = won && i === winIdx;
              const name = p.kick_username.length > 10 ? `${p.kick_username.slice(0, 9)}…` : p.kick_username;
              return (
                <g key={p.id}>
                  {n === 1 ? (
                    <circle r={R} className={gold ? "fill-brand" : "fill-row"} />
                  ) : (
                    <path
                      d={`M0 0L${x1} ${y1}A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2}Z`}
                      className={cn("stroke-row-edge transition-colors duration-200", gold ? "fill-brand" : i % 2 ? "fill-muted" : "fill-row")}
                    />
                  )}
                  <text
                    x={lx}
                    y={ly}
                    transform={n === 1 ? undefined : `rotate(${mid} ${lx} ${ly})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={cn("text-[11px] font-medium", gold ? "fill-background" : "fill-foreground")}
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
      {breaking && <ShieldBreak />}
    </div>
  );
}

// Names type in (P8): the protected name types in, the shield breaks over the line, and the
// stand-in's name types in its place; with no stand-in the line goes. `at` is when typing starts.
export function NearMissName({ save, at, children }: { save: Save; at: number; children?: React.ReactNode }) {
  const typed = at + [...save.protectedPlayer.kick_username].length * REVEAL.speed + REVEAL.sharpen;
  const standin = !!save.standin;
  const [breaking, setBreaking] = useState(false); // the shield stays mounted until its halves land
  const [swapped, setSwapped] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const ids = [
      setTimeout(() => setBreaking(true), typed + SLAM_AT),
      setTimeout(() => setSwapped(standin), typed + SLAM_AT + BREAK.split),
      setTimeout(() => {
        setBreaking(false);
        setGone(!standin);
      }, typed + SLAM_AT + BREAK.done),
    ];
    return () => ids.forEach(clearTimeout);
  }, [typed, standin]);
  if (gone) return null;
  const name = swapped && save.standin ? save.standin.kick_username : save.protectedPlayer.kick_username;
  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-row-edge bg-background px-4 py-3">
      <Typed key={swapped ? "s" : "p"} text={name} speed={REVEAL.speed} reveal={REVEAL.sharpen}
        startDelay={swapped ? 0 : at} className="text-name" />
      {swapped && children}
      {breaking && <ShieldBreak />}
    </div>
  );
}
