"use client";
import { Check, Copy, Heart, RefreshCw, Shield, TrendingDown, TrendingUp, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { BADGE_LOOK, BADGES } from "@/components/queue/badge-picker";
import { PROFILE_ICON, Tag, useCopy, useRankPending, useRanks, useRefreshRank } from "@/components/queue/player-row";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsTouch } from "@/components/use-client-state";
import type { LabelKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Player } from "@/types/queue";

const TIER_TEXT: Record<string, string> = {
  IRON: "text-rank-iron", BRONZE: "text-rank-bronze", SILVER: "text-rank-silver", GOLD: "text-rank-gold",
  PLATINUM: "text-rank-platinum", EMERALD: "text-rank-emerald", DIAMOND: "text-rank-diamond", MASTER: "text-rank-master",
  GRANDMASTER: "text-rank-grandmaster", CHALLENGER: "text-rank-challenger",
};
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

// A value copied on click; its icon turns into a check for 1.5 s and a toast names it. Children
// truncate themselves (a Riot ID keeps its #TAG in view).
function CopyText({ text, label, className, children }: { text: string; label: string; className?: string; children: React.ReactNode }) {
  const copy = useCopy();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  const Icon = done ? Check : Copy;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void copy(text).then(setDone)}
      className={cn("inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40", className)}
    >
      <span className="flex min-w-0">{children}</span>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", done ? "text-success" : "text-muted-foreground")} />
    </button>
  );
}

// The player card (D31, DESIGN.md § Player card): everything the store already knows about a
// player, read by id; nothing is fetched on hover. `seen` is the player as the row shows them
// (no Riot ID with Riot IDs off, no rank with ranks off).
export function PlayerCard({ player, seen }: { player: Player; seen: Player }) {
  const { t, lang } = useT();
  const ranks = useRanks();
  const pending = useRankPending(player);
  const canWrite = useCanWrite();
  const refresh = useRefreshRank(player);
  const fairPlay = useQueue((v) => v.settings.fair_play);
  const respect = useQueue((v) => v.respect[player.kick_username.toLowerCase()]) ?? 100;
  const r = seen.rank;
  const icon = r?.icon;
  const w = r?.wins ?? 0;
  const l = r?.losses ?? 0;
  const pct = w + l > 0 ? (w / (w + l)) * 100 : null;
  const badges = BADGES.filter((b) => player.badges.includes(b));
  const joined = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(player.joined_at));
  const tier = r?.tier ? t(`rank.${r.tier}` as LabelKey) : null;

  return (
    <div className="flex flex-col gap-3 text-meta">
      <div className="flex items-start gap-3">
        {ranks && Number.isInteger(icon) ? (
          // eslint-disable-next-line @next/next/no-img-element -- a sized 48px icon; img-src allows only this CDN
          <img src={PROFILE_ICON(icon!)} alt="" width={48} height={48} className="size-12 shrink-0 rounded-lg border border-row-edge" />
        ) : (
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-lg border border-row-edge text-title text-muted-foreground uppercase">
            {(seen.riot_id ?? player.kick_username).slice(0, 1)}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            {seen.riot_id ? (
              <CopyText text={seen.riot_id} label={t("menu.copy_riot")} className="font-mono text-code">
                {/* A long name truncates; the #TAG stays (owner, 2026-09-28). */}
                <span className="truncate">{seen.riot_id.split("#")[0]}</span>
                {seen.riot_id.includes("#") && <span className="shrink-0">#{seen.riot_id.split("#")[1]}</span>}
              </CopyText>
            ) : (
              <span className="truncate text-name">{player.kick_username}</span>
            )}
            {ranks && r?.level != null && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{t("card.level", { n: r.level })}</span>}
          </div>
          {badges.length > 0 && (
            <span className="flex items-center gap-1.5">
              {badges.map((b) => {
                const { icon: Icon, tone } = BADGE_LOOK[b];
                return (
                  <Tip key={b} label={t(`badge.${b}`)}>
                    <span tabIndex={0} aria-label={t(`badge.${b}`)} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                      <Icon aria-hidden className={cn("size-4", tone)} />
                    </span>
                  </Tip>
                );
              })}
            </span>
          )}
        </div>
      </div>

      {ranks && seen.riot_id && (
        <div className="flex flex-col gap-1.5 border-t border-row-edge pt-3">
          {pending ? (
            <>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-44" />
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <Shield aria-hidden className={cn("size-4", r?.tier ? TIER_TEXT[r.tier] : "text-muted-foreground")} />
                {tier
                  ? APEX.has(r!.tier) ? `${tier} ${r!.lp ?? 0} LP` : `${tier} ${r!.division ?? ""} ${r!.lp ?? 0} LP`
                  : t(r ? "card.unranked" : "card.rank_unavailable")}
              </span>
              {pct !== null && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-3 tabular-nums">
                    <span>{t("card.wl", { w, l })}</span>
                    <span className={cn("inline-flex items-center gap-1", pct >= 50 ? "text-success" : "text-muted-foreground")}>
                      {pct >= 50 ? <TrendingUp aria-hidden className="size-3.5" /> : <TrendingDown aria-hidden className="size-3.5" />}
                      {pct.toFixed(1)}%
                    </span>
                  </span>
                  <span aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
                    <span style={{ width: `${pct}%` }} className={cn("block h-full rounded-full", pct >= 50 ? "bg-success" : "bg-muted-foreground")} />
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* No separator glyphs (owner rule): each fact is its own item. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          {respect}
          <Heart aria-hidden className={cn("size-3.5", respect >= 80 ? "text-success" : respect >= 50 ? "text-warning" : "text-destructive")} />
          {t("card.respect")}
        </span>
        {/* A player the dashboard added reads Manual, highlighted (owner, 2026-09-28). */}
        {player.source === "chat" ? (
          <span>{t("card.joined_chat_at", { time: joined })}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Tag tone="brand" icon={UserPlus}>{t("card.manual")}</Tag>
            <span className="tabular-nums">{joined}</span>
          </span>
        )}
        {fairPlay && <span>{t("card.games", { n: player.games_played })}</span>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-row-edge pt-3">
        <CopyText text={player.kick_username} label={t("menu.copy_name")} className="text-muted-foreground">
          <span className="truncate">{player.kick_username}</span>
        </CopyText>
        {ranks && seen.riot_id && (
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={refresh}>
            {/* The tier's colour, as the shield above (colour means something, DESIGN.md § Icons). */}
            <RefreshCw aria-hidden className={r?.tier ? TIER_TEXT[r.tier] : undefined} />
            {t("menu.refresh_rank")}
          </Button>
        )}
      </div>
    </div>
  );
}

// Only one card is open at a time; the next one within this window opens at once (instantly
// between neighbours).
let lastOpen = 0;
const STILL_MS = 500;
const menuOpen = () => !!document.querySelector("[data-slot=context-menu-content], [data-slot=dropdown-menu-content]");

// Where the card opens (D31): only from the name, after 500 ms of stillness over it (never while
// the pointer crosses rows), or after the row has held keyboard focus as long. It closes at once
// on any press, right-click, drag, scroll or key, and stays shut while a menu is open. On touch
// a tap on the name opens it.
export function CardTrigger({ player, seen, keyboard, children }: {
  player: Player;
  seen: Player;
  /** The row holds keyboard focus. */
  keyboard: boolean;
  children: React.ReactNode;
}) {
  const touch = useIsTouch();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(leave.current);
    setOpen((o) => {
      if (o) lastOpen = Date.now();
      return false;
    });
  }, []);
  const arm = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => !menuOpen() && setOpen(true), ms);
  }, []);

  useEffect(() => {
    // Losing focus came from a press or a key, which already closed it.
    if (keyboard) arm(STILL_MS);
    else clearTimeout(timer.current);
  }, [keyboard, arm]);

  useEffect(() => {
    if (!open) return;
    const shut = (e: Event) => {
      // A press inside the card (copy, refresh) keeps it open.
      const el = e.target as Element | null;
      if (e.type === "pointerdown" && el?.closest?.("[data-player-card]")) return;
      // On touch the name's own tap toggles it.
      if (touch && e.type === "pointerdown" && anchor.current?.contains(el)) return;
      close();
    };
    const events = ["pointerdown", "contextmenu", "dragstart", "wheel", "keydown"] as const;
    events.forEach((ev) => window.addEventListener(ev, shut, true));
    window.addEventListener("scroll", close, true);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, shut, true));
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close, touch]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pointer = touch
    ? { onClick: () => setOpen((o) => !o) }
    : {
        onPointerMove: () => !open && arm(Date.now() - lastOpen < 300 ? 0 : STILL_MS),
        onPointerLeave: () => {
          clearTimeout(timer.current);
          leave.current = setTimeout(close, 120);
        },
      };
  return (
    <Popover open={open} onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        <span ref={anchor} className="flex min-w-0" {...pointer}>
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        data-player-card
        align="start"
        side="right"
        sideOffset={12}
        collisionPadding={16}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => clearTimeout(leave.current)}
        onPointerLeave={() => !touch && close()}
        className="w-80 rounded-xl p-4 shadow-md"
      >
        <PlayerCard player={player} seen={seen} />
      </PopoverContent>
    </Popover>
  );
}
