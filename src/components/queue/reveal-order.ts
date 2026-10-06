import type { DrawEntry } from "@/types/queue";

// Shared by the dashboard's Teams tab and /watch, in a module of its own so /watch does not load
// the dashboard.
// The draw reveal's cadence (DESIGN.md § The draw reveal): one name every 160ms, each typed at
// 30ms a character and sharpening over 200ms. Off the motion ladder on purpose: it is a sequence.
export const REVEAL = { step: 160, speed: 30, sharpen: 200 };

export type Landing = { entry: DrawEntry; team: 0 | 1; at: number };

// Team 1, team 2, alternately.
export function revealOrder(lists: DrawEntry[][]): Landing[] {
  const out: Landing[] = [];
  let k = 0;
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    lists.forEach((l, team) => {
      if (l[i]) out.push({ entry: l[i], team: team as 0 | 1, at: k++ * REVEAL.step });
    });
  }
  return out;
}

export function revealDuration(order: Landing[]): number {
  return Math.max(0, ...order.map((o) => o.at + [...o.entry.kick_username].length * REVEAL.speed + REVEAL.sharpen));
}
