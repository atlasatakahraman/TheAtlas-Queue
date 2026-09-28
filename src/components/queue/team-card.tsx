"use client";
import { type LucideIcon, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { useT } from "@/components/i18n";
import { Typed } from "@/components/prefs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CARD_HEAD, MIRROR, SLOT } from "@/components/queue/geometry";
import { REVEAL, revealDuration, revealOrder } from "@/components/queue/reveal-order";
import type { LabelKey } from "@/lib/i18n";
import { averageRank } from "@/lib/rank";
import { cn } from "@/lib/utils";
import type { Draw, Player } from "@/types/queue";

// A team card as it draws, for the dashboard's Teams tab and /watch alike (owner, 2026-09-28: one
// card). Fed plain data, no store: the dashboard wraps it with Add, Victory, row buttons, menus
// and drag; /watch uses it bare, so its bundle holds none of those.

type Face = Pick<Player, "kick_username" | "riot_id" | "rank">;

const TIER_MARK: Record<string, string> = {
  IRON: "bg-rank-iron", BRONZE: "bg-rank-bronze", SILVER: "bg-rank-silver", GOLD: "bg-rank-gold",
  PLATINUM: "bg-rank-platinum", EMERALD: "bg-rank-emerald", DIAMOND: "bg-rank-diamond", MASTER: "bg-rank-master",
  GRANDMASTER: "bg-rank-grandmaster", CHALLENGER: "bg-rank-challenger",
};
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export function RankText({ player, className }: { player: Pick<Player, "rank">; className?: string }) {
  const { t } = useT();
  const r = player.rank;
  if (!r?.tier) return null;
  const tier = t(`rank.${r.tier}` as LabelKey);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta text-muted-foreground", className)}>
      {/* The tier's colour as a 3px bar, the row's own edge in small (no dots, owner 2026-09-27). */}
      <span className={cn("h-3 w-[3px] shrink-0 rounded-[1px]", TIER_MARK[r.tier] ?? "bg-muted-foreground")} aria-hidden />
      {APEX.has(r.tier) ? `${tier} ${r.lp ?? 0} LP` : `${tier} ${r.division ?? ""}`.trim()}
    </span>
  );
}

// Tags (D36): an icon and a word in the role colour, no capsule; colour is never the only signal
// (DESIGN.md § Recipes → Tags). `fold` tags sit on a name's line: under 20rem of line the word
// folds into a tooltip and the icon stays, after the name has truncated.
const TONES = {
  brand: "text-brand",
  "team-1": "text-team-1",
  "team-2": "text-team-2",
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function Tag({ tone, icon: Icon, fold = false, children }: {
  tone: keyof typeof TONES;
  icon?: LucideIcon;
  fold?: boolean;
  children: React.ReactNode;
}) {
  const tag = (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-meta font-medium select-none", TONES[tone])}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className={cn(fold && "@max-xs/name:sr-only")}>{children}</span>
    </span>
  );
  if (!fold) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tag}</TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

// Riot profile icon, as the August queue showed it. ponytail: Data Dragon is versioned; icons
// newer than this version fall back to the initial. Bump the version when that shows.
export const PROFILE_ICON = (id: number) => `https://ddragon.leagueoflegends.com/cdn/15.7.1/img/profileicon/${id}.png`;

export function PlayerAvatar({ player }: { player: Face }) {
  const name = player.riot_id?.split("#")[0] || player.kick_username;
  return (
    <Avatar className="size-9 border border-row-edge">
      {player.rank?.icon != null && <AvatarImage src={PROFILE_ICON(player.rank.icon)} alt="" />}
      <AvatarFallback className="bg-transparent text-meta text-muted-foreground uppercase">{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

// The name: the Riot game name with its #TAG beside or under it (August's queue), the Kick name
// when there is no Riot ID. `typeAt` types it in, for a draw landing.
export function NameText({ player, stacked, typeAt }: { player: Face; stacked: boolean; typeAt?: number }) {
  const [game, tag] = player.riot_id ? player.riot_id.split("#") : [player.kick_username, null];
  return (
    <span className={cn("flex min-w-0", stacked ? "flex-col" : "items-baseline gap-1")}>
      <span className="truncate text-name">
        {typeAt === undefined ? game : <Typed text={game} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={typeAt} />}
      </span>
      {tag && (
        <span
          style={typeAt === undefined ? undefined : { animationDelay: `${typeAt + [...game].length * REVEAL.speed}ms` }}
          className={cn("truncate font-mono text-caption tracking-normal normal-case text-muted-foreground", typeAt !== undefined && "animate-enter")}
        >
          #{tag}
        </span>
      )}
    </span>
  );
}

// The count in Newsreader, as the tab counts, and gold alone once the team is full (owner,
// 2026-09-28); {n} is left in the label to place it.
export function TeamCount({ count, size }: { count: number; size: number }) {
  const { t } = useT();
  return (
    <span className="tabular-nums">
      {t("teams.count", { size })
        .split("{n}")
        .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className={cn("font-serif font-medium", count >= size && "text-brand")}>{count}</span>, part]))}
    </span>
  );
}

export function Avg({ players }: { players: Pick<Player, "rank">[] }) {
  const { t } = useT();
  const avg = averageRank(players as Player[]);
  if (!avg) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {t("teams.avg")}
      <RankText player={{ rank: { tier: avg.tier, division: avg.division, lp: null, icon: null } }} />
    </span>
  );
}

// Every roster slot is one row high (SLOT), filled or not: a team card holds team-size slots
// (August's fixed team boxes), so the cards keep their height while names land and leave.
export const EMPTY_SLOT = cn(
  "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 rounded-xl border border-dashed border-row-edge px-4 py-3 text-left",
  SLOT,
);

export function EmptySlotBody({ n }: { n: number }) {
  const { t } = useT();
  return (
    <>
      <span className="font-serif text-numeral text-muted-foreground/50 tabular-nums select-none">{n}</span>
      <span className="inline-flex items-center gap-2 text-meta text-muted-foreground">
        <UserPlus className="size-4" aria-hidden />
        {t("teams.slot.empty")}
      </span>
    </>
  );
}

// A team's slots in order, a player or null: each player in their own slot, one without a free
// one of their own (a write still landing) in the first empty slot.
export function slotLayout<P extends Pick<Player, "team_slot">>(roster: P[], size: number): (P | null)[] {
  const out: (P | null)[] = Array.from({ length: Math.max(size, roster.length) }, () => null);
  const rest: P[] = [];
  for (const p of roster) {
    const i = (p.team_slot ?? 0) - 1;
    if (i >= 0 && i < out.length && !out[i]) out[i] = p;
    else rest.push(p);
  }
  for (const p of rest) {
    const i = out.indexOf(null);
    if (i < 0) out.push(p);
    else out[i] = p;
  }
  return out;
}

// A fresh draw lands in the live rosters themselves: each drawn row rises into its slot and types
// the name it keeps showing, so nothing is swapped when the reveal ends (owner, 2026-09-27: the
// avatars used to jump in after the names). Rows land in roster order, alternating teams.
export function useLanding(draw: Pick<Draw, "result"> | null, rosters: Pick<Player, "id" | "kick_username" | "riot_id" | "locked">[][]) {
  return useMemo(() => {
    if (!draw) return null;
    const ids = new Set((draw.result.teams ?? []).flat().map((e) => e.id));
    const lists = rosters.map((r) =>
      r.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, kick_username: p.riot_id?.split("#")[0] ?? p.kick_username, locked: p.locked })),
    );
    const order = revealOrder(lists);
    return { at: new Map(order.map((o) => [o.entry.id, o.at])), duration: revealDuration(order) };
  }, [draw, rosters]);
}

// The card: the team's colour along its top, the header line (the count and average on the
// outer side, the actions on the inner), then the slots. No team name: the match headline above
// names both teams (owner, 2026-09-23).
export function TeamCardView({ team, head, actions, children, className, ...props }: {
  team: 1 | 2;
  head: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"section">, "children">) {
  const { t } = useT();
  return (
    <section {...props} className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl bg-card", className)}>
      <div className={cn("h-[5px]", team === 1 ? "bg-team-1" : "bg-team-2")} aria-hidden />
      <div className="flex flex-col gap-3 p-4">
        <header aria-label={t(`team.${team}`)} className={cn(CARD_HEAD, team === 2 && MIRROR)}>
          {head}
          {/* Victory beside Add, on the inner side of it (owner, 2026-09-28). */}
          {actions && <span className={cn("flex shrink-0 items-center gap-2", team === 2 && MIRROR)}>{actions}</span>}
        </header>
        <div data-rows className="@container flex flex-col gap-1.5">
          {children}
        </div>
      </div>
    </section>
  );
}
