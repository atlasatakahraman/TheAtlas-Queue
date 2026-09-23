import type { Player } from "@/types/queue";

const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVISIONS = ["IV", "III", "II", "I"];
const APEX = TIERS.indexOf("MASTER");

// One number per rank so a team's ranks can be averaged: 100 per division below Master, then LP.
function score(p: Player): number | null {
  const r = p.rank;
  const t = r?.tier ? TIERS.indexOf(r.tier) : -1;
  if (t < 0) return null;
  if (t >= APEX) return APEX * 400 + (r!.lp ?? 0);
  return t * 400 + Math.max(0, DIVISIONS.indexOf(r!.division ?? "IV")) * 100 + Math.min(r!.lp ?? 0, 99);
}

// The average rank of a team, as a tier and division, or null when nobody has a rank.
export function averageRank(players: Player[]): { tier: string; division: string | null } | null {
  const s = players.map(score).filter((x): x is number => x !== null);
  if (s.length === 0) return null;
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  if (avg >= APEX * 400) return { tier: "MASTER", division: null };
  const t = Math.floor(avg / 400);
  return { tier: TIERS[t], division: DIVISIONS[Math.floor((avg - t * 400) / 100)] };
}
