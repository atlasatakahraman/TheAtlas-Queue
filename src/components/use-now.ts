"use client";
import { useSyncExternalStore } from "react";

// A clock that ticks every `ms` for relative times. It reads 0 during the server render and
// hydration, so a relative time renders only on the client and never mismatches.
let now = 0;
const clocks = new Map<number, (cb: () => void) => () => void>();

// One stable subscribe function per interval: a new one per render would resubscribe forever.
function clock(ms: number) {
  let sub = clocks.get(ms);
  if (sub) return sub;
  const subs = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  sub = (cb) => {
    if (subs.size === 0) {
      now = Date.now();
      timer = setInterval(() => {
        now = Date.now();
        subs.forEach((f) => f());
      }, ms);
    }
    subs.add(cb);
    return () => {
      subs.delete(cb);
      if (subs.size === 0) clearInterval(timer);
    };
  };
  clocks.set(ms, sub);
  return sub;
}

export function useNow(ms = 15_000): number {
  return useSyncExternalStore(clock(ms), () => now, () => 0);
}
