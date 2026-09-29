import type { Draw, DrawEntry } from "@/types/queue";

// Shared by the dashboard's Teams tab and /watch, in a module of its own so /watch does not load
// the dashboard.
// The draw reveal's cadence (DESIGN.md § The draw reveal): one name every 160ms, each typed at
// 30ms a character and sharpening over 200ms. Off the motion ladder on purpose: it is a sequence.
// Protection used (0041): a shield stamps on for `stamp`, then a `beat` before the others land.
export const REVEAL = { step: 160, speed: 30, sharpen: 200, stamp: 480, beat: 700 };

export type Landing = { entry: DrawEntry; team: 0 | 1; at: number };

// Team 1, team 2, alternately. Each list already starts with its protected players, so they
// land first, "because they were never in doubt". Those who spent a pick in this draw (`used`)
// land before anyone else; the shield stamps, a beat passes, then the rest land (the redraw).
export function revealOrder(lists: DrawEntry[][], used?: ReadonlySet<string>): Landing[] {
  const out: Landing[] = [];
  const land = (ls: DrawEntry[][], from: number) => {
    let k = 0;
    for (let i = 0; i < Math.max(0, ...ls.map((l) => l.length)); i++) {
      ls.forEach((l, team) => {
        if (l[i]) out.push({ entry: l[i], team: team as 0 | 1, at: from + k++ * REVEAL.step });
      });
    }
  };
  if (!used?.size) {
    land(lists, 0);
    return out;
  }
  land(lists.map((l) => l.filter((e) => used.has(e.id))), 0);
  const last = out.at(-1);
  land(lists.map((l) => l.filter((e) => !used.has(e.id))), last ? last.at + REVEAL.stamp + REVEAL.beat : 0);
  return out;
}

// The draw's shields by player: picks left, and whether this draw spent one.
export function shieldsOf(draw: Pick<Draw, "result"> | null | undefined): Map<string, { left: number; used: boolean }> {
  return new Map((draw?.result.protected ?? []).map((s) => [s.id, { left: s.left, used: s.used }]));
}

export function revealDuration(order: Landing[]): number {
  return Math.max(0, ...order.map((o) => o.at + [...o.entry.kick_username].length * REVEAL.speed + REVEAL.sharpen));
}
