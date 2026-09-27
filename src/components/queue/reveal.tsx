"use client";
import { type LucideIcon, Undo2, UserPlus, Users, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useT } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import { usePlayerActions, useTeamRoom } from "@/components/queue/player-row";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useAct, useCanWrite, useQueue, useStore } from "@/components/queue/store";
import { LandingName, revealOrder, useRevealMotion } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";
import type { Player } from "@/types/queue";

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
  const act = useAct();
  const canWrite = useCanWrite();
  const room = useTeamRoom();
  const reveal = useQueue((v) => v.reveal);
  const players = useQueue((v) => v.players);
  const motion = useRevealMotion();
  const pick = reveal?.kind === "pick" ? reveal : null;
  const order = useMemo(() => revealOrder([pick?.result.picked ?? []]), [pick]);
  // The picked players as they are now: a row acted on shows its new state, a removed one goes.
  const live = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const here = order.flatMap((o) => live.get(o.entry.id) ?? []);
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
  return (
    <ResponsiveDialog open={!!pick} onOpenChange={(o) => !o && store.clearReveal()} title={t("action.pick")}>
      <div className="flex flex-col gap-1.5">
        {order.map((o) => {
          const p = live.get(o.entry.id);
          return (
            <LandingName key={o.entry.id} entry={o.entry} at={motion ? o.at : 0}>
              {p ? <PickedActions p={p} /> : <span className="ml-auto text-meta text-muted-foreground">{t("pick.removed")}</span>}
            </LandingName>
          );
        })}
      </div>
      {here.length > 1 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
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
    </ResponsiveDialog>
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
