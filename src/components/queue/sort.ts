"use client";
import { useStored } from "@/components/use-client-state";
import type { Player } from "@/types/queue";

// Sorting the queue table (D35): a view only. Pick, the draw and the # column keep the queue
// order; dragging is off while a column sort is on. Remembered per browser.
export type SortKey = "name" | "rank" | "winrate" | "joined";
type Dir = "asc" | "desc";
const SORTS = [
  "queue",
  "name-asc", "name-desc", "rank-asc", "rank-desc", "winrate-asc", "winrate-desc", "joined-asc", "joined-desc",
] as const;
type Sort = (typeof SORTS)[number];
// The first click: names A to Z, the highest rank and win rate first, the earliest join first.
const FIRST: Record<SortKey, Dir> = { name: "asc", rank: "desc", winrate: "desc", joined: "asc" };

export function useQueueSort(ranks: boolean) {
  const [v, set] = useStored<Sort>("queue.sort", "queue", SORTS);
  const [k, d] = v === "queue" ? [null, null] : (v.split("-") as [SortKey, Dir]);
  // Rank and win rate leave with ranks off; their sort falls back to the queue order.
  const key = k && (ranks || (k !== "rank" && k !== "winrate")) ? k : null;
  return {
    key,
    dir: key ? d : null,
    // A second click on the sorted column flips it.
    toggle: (to: SortKey) => set(`${to}-${key === to ? (d === "asc" ? "desc" : "asc") : FIRST[to]}` as Sort),
    reset: () => set("queue"),
  };
}

const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISIONS = ["IV", "III", "II", "I"];

function value(p: Player, key: SortKey, ids: boolean): number | string | null {
  const r = p.rank;
  if (key === "name") return (ids && p.riot_id?.split("#")[0]) || p.kick_username;
  if (key === "joined") return Date.parse(p.joined_at);
  if (key === "rank") {
    const tier = r?.tier ? TIERS.indexOf(r.tier) : -1;
    return tier < 0 ? null : tier * 1e5 + Math.max(0, DIVISIONS.indexOf(r?.division ?? "")) * 1e4 + (r?.lp ?? 0);
  }
  const games = (r?.wins ?? 0) + (r?.losses ?? 0);
  return games > 0 ? (r?.wins ?? 0) / games : null;
}

const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

// Unranked and no-games rows go last in either direction; ties keep the queue order.
export function sortPlayers<T extends { p: Player }>(rows: T[], key: SortKey | null, dir: Dir | null, ids: boolean): T[] {
  if (!key) return rows;
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: value(row.p, key, ids) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const c = typeof a.v === "string" ? collator.compare(a.v, b.v as string) : (a.v as number) - (b.v as number);
      return c * sign || a.i - b.i;
    })
    .map((x) => x.row);
}
