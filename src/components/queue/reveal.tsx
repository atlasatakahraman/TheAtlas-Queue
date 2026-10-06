"use client";
import { FastForward, type LucideIcon, RotateCcw, Undo2, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { usePlayerActions, useTeamRoom } from "@/components/queue/player-row";
import { NearMissName, poolWith, type Save, STAGED, Stage, type Staged } from "@/components/queue/pick-stages";
import { REVEAL } from "@/components/queue/reveal-order";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useAct, useCanWrite, useQueue, useServerActions, useStore } from "@/components/queue/store";
import { LandingName, pickPool, revealOrder, useDrawActions, usePick, useRevealMotion } from "@/components/queue/teams-tab";
import { useMotion } from "@/components/prefs";
import { useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";
import type { Draw, DrawEntry, DrawSave, Player } from "@/types/queue";

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
      {shown && <PickBody key={shown.id} draw={shown} />}
    </ResponsiveDialog>
  );
}

// One pick: with Cards, List or Wheel each name plays its reveal in turn (D22, DESIGN.md § The
// draw reveal), joining the list when it stops; otherwise the names land as the team draw's do.
function PickBody({ draw }: { draw: Draw }) {
  const picked = useMemo(() => draw.result.picked ?? [], [draw]);
  const saved = useMemo(() => draw.result.saved ?? [], [draw]);
  // The reveal's slots (P8): each picked name — a near miss first where a stand-in took a
  // protected player's place — then the saves nobody could stand in for.
  const slots = useMemo(
    () => [
      ...picked.map((e) => ({ entry: e as DrawEntry | null, save: saved.find((s) => s.standin_id === e.id) })),
      ...saved.filter((s) => !s.standin_id).map((s) => ({ entry: null, save: s as DrawSave | undefined })),
    ],
    [picked, saved],
  );
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
  const { announceSaves } = useServerActions();
  const channelId = useQueue((v) => v.channel.id);
  // The pool the reveal runs over: this browser's pick source as the pick found it, the picked
  // and saved names included. ponytail: a draw row does not record its source, so another
  // member's pick from a different source shows this browser's pool; where it stops is still the
  // server's.
  const [pool] = useState(() => {
    const view = store.get();
    const named = new Set([...picked.map((e) => e.id), ...saved.map((s) => s.id)]);
    const rest = pickPool(view, source).filter((p) => !named.has(p.id));
    return [...rest, ...[...named].flatMap((id) => view.players.find((p) => p.id === id) ?? [])];
  });
  const [step, setStep] = useState(staged ? 0 : slots.length);
  const playing = step < slots.length;
  const order = useMemo(() => revealOrder([picked]), [picked]);
  // The picked players as they are now: a row acted on shows its new state, a removed one goes.
  const live = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const taken = new Set(slots.slice(0, step).flatMap((s) => (s.entry ? [s.entry.id] : [])));
  const shown = order.filter((o) => taken.has(o.entry.id));
  const here = shown.flatMap((o) => live.get(o.entry.id) ?? []);
  const again = useRef<HTMLButtonElement>(null);
  const next = useCallback(() => setStep((n) => n + 1), []);
  const saveOf = (s: DrawSave | undefined, entry: DrawEntry | null): Save | undefined => {
    const prot = s && pool.find((p) => p.id === s.id);
    return prot ? { protectedPlayer: prot, standin: (entry && pool.find((p) => p.id === entry.id)) ?? null } : undefined;
  };
  // The kept-on-team chat line once the reveal is over (P9), so chat never spoils the wheel.
  useEffect(() => {
    if (!playing && saved.length) void announceSaves(channelId, draw.id);
  }, [playing, saved.length, announceSaves, channelId, draw.id]);

  // Enter or Space skips a reveal that is playing (August); once it has stopped, focus sits on
  // Pick again, so the same keys pick again.
  useEffect(() => {
    if (!playing) return void again.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      setStep(slots.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, slots.length]);

  // All to Team N (owner, 2026-09-27): one write, one Undo; those already there stay. It closes
  // the dialog, the pick being done (owner, 2026-09-28); a single name's move keeps it open.
  const allTo = (n: 1 | 2) => {
    const ids = here.filter((p) => !(p.status === "playing" && p.team === n)).map((p) => p.id);
    return {
      ids,
      run: () => {
        store.clearReveal();
        return act("move_players", { p_ids: ids, p_team: n }, {
          optimistic: { ids, patch: (x) => ({ ...x, status: "playing", team: n }) },
          done: "done.move_all",
          vars: { n: ids.length, team: t(`team.${n}`) },
        });
      },
    };
  };
  return (
    <>
      {playing && staged && (
        <Stage key={step} style={staged} pool={poolWith(pool.filter((p) => !taken.has(p.id)))}
          winner={slots[step].entry?.id ?? null} save={saveOf(slots[step].save, slots[step].entry)} onDone={next} />
      )}
      {/* A save nobody could stand in for still plays its near miss when the pick named nobody. */}
      {(shown.length > 0 || (!staged && typing && saved.some((s) => !s.standin_id))) && (
        <div className="flex flex-col gap-1.5">
          {shown.map((o) => {
            const p = live.get(o.entry.id);
            const actions = p ? <PickedActions p={p} /> : <span className="ml-auto text-meta text-muted-foreground">{t("pick.removed")}</span>;
            const save = !staged && typing ? saveOf(saved.find((s) => s.standin_id === o.entry.id), o.entry) : undefined;
            return save ? (
              <NearMissName key={o.entry.id} save={save} at={o.at}>{actions}</NearMissName>
            ) : (
              <LandingName key={o.entry.id} entry={o.entry} at={typing ? o.at : 0} typed={!staged}>{actions}</LandingName>
            );
          })}
          {!staged && typing && saved.filter((s) => !s.standin_id).map((s) => {
            const save = saveOf(s, null);
            return save ? <NearMissName key={s.id} save={save} at={(order.at(-1)?.at ?? 0) + REVEAL.step} /> : null;
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
          <Button variant="outline" size="lg" className="max-md:h-11" onClick={() => setStep(slots.length)}>
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
            onClick={() => void pickAgain(draw.n, source, true)}
          >
            <RotateCcw aria-hidden />
            {t("pick.again")}
          </Button>
        )}
      </div>
    </>
  );
}

// One picked name's moves: either team, back to waiting, out of the queue. A move that cannot
// happen is disabled, never hidden (owner, 2026-09-27).
function PickedActions({ p }: { p: Player }) {
  const { t } = useT();
  const a = usePlayerActions(p);
  const canWrite = useCanWrite();
  const room = useTeamRoom();
  const size = useQueue((v) => v.settings.team_size);
  // Why a move is disabled (D25), shown in its tooltip; null when it can run.
  const moves: { label: string; icon: LucideIcon; tone: string; run: () => unknown; why: string | null }[] = [
    ...([1, 2] as const).map((n) => ({
      label: t("menu.move_to", { team: t(`team.${n}`) }),
      icon: UserPlus,
      tone: n === 1 ? "text-team-1 hover:text-team-1" : "text-team-2 hover:text-team-2",
      run: () => a.moveTo(n),
      why:
        p.team === n
          ? t("why.already_in", { team: t(`team.${n}`) })
          : room(n) < 1
            ? t("why.team_full", { team: t(`team.${n}`), n: size - room(n), size })
            : null,
    })),
    { label: t("menu.to_waiting"), icon: Undo2, tone: "text-muted-foreground", run: a.toWaiting, why: p.status !== "playing" ? t("why.already_waiting") : null },
    { label: t("menu.remove"), icon: X, tone: "text-muted-foreground", run: a.remove, why: null },
  ];
  return (
    <span className="ml-auto flex shrink-0 items-center">
      {moves.map(({ label, icon: Icon, tone, run, why }) => (
        <Tip key={label} label={!canWrite ? t("why.offline") : (why ?? label)}>
          <Button
            variant="ghost"
            size="icon"
            className={cn("max-md:size-11", tone)}
            disabled={!canWrite || !!why}
            aria-label={label}
            onClick={() => void run()}
          >
            <Icon aria-hidden />
          </Button>
        </Tip>
      ))}
    </span>
  );
}
