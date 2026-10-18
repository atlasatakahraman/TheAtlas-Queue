"use client";
import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { pickPool, useDrawActions, usePick } from "@/components/queue/teams-tab";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Player } from "@/types/queue";

const MAX_PICK = 10;
type Group = "waiting" | "team1" | "team2";
const GROUPS: readonly Group[] = ["waiting", "team1", "team2"];
const groupOf = (p: Player): Group => (p.status === "waiting" ? "waiting" : p.team === 2 ? "team2" : "team1");

// Custom pick (spec § 3, C1–C8): tick the pool by hand, then pick N from it at random. Only
// players a pick can reach are listed (C3), ticks are saved for this channel at once (C5), and the
// three group toggles plus the name search are the only bulk tools (C8).
export function CustomPickDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useT();
  const canWrite = useCanWrite();
  const { pick } = useDrawActions();
  const { custom, setCustom } = usePick();
  const view = useQueue((v) => v);
  const [q, setQ] = useState("");
  const [n, setN] = useState(1);

  // Who a pick can reach: waiting or on a team, under no live ban or punishment (C3).
  const rows = useMemo(() => pickPool(view, "all"), [view]);
  const ticked = useMemo(() => {
    const set = new Set(custom);
    return new Set(rows.filter((p) => set.has(p.id)).map((p) => p.id));
  }, [rows, custom]);
  const groups = useMemo(() => GROUPS.map((g) => ({ g, players: rows.filter((p) => groupOf(p) === g) })), [rows]);
  const needle = q.trim().toLowerCase();
  const cap = Math.min(MAX_PICK, ticked.size);
  const count = Math.max(1, Math.min(n, cap));

  // Every write keeps only players still listed, so a name that left drops out of the saved pool.
  const write = (next: Set<string>) => setCustom(rows.filter((p) => next.has(p.id)).map((p) => p.id));
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(ticked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    write(next);
  };
  const label = (g: Group) => (g === "waiting" ? t("pick.source.waiting") : t(g === "team1" ? "team.1" : "team.2"));
  // The search starts empty each time, so a reopened dialog never hides everyone behind an old filter.
  const change = (o: boolean) => {
    if (!o) setQ("");
    onOpenChange(o);
  };
  const run = () => {
    change(false);
    void pick(count, "custom", false, [...ticked]);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={change}
      returnFocus={returnFocus}
      title={t("custom.title")}
      description={t("custom.description")}
      footer={
        <>
          <div role="group" aria-label={t("custom.count")} className="me-auto flex items-center gap-1">
            <Button variant="outline" size="icon" className="max-md:size-11" aria-label={t("custom.fewer")} disabled={count <= 1} onClick={() => setN(count - 1)}>
              <Minus aria-hidden />
            </Button>
            <output aria-live="polite" className="min-w-8 text-center font-serif text-title tabular-nums">
              {count}
            </output>
            <Button variant="outline" size="icon" className="max-md:size-11" aria-label={t("custom.more")} disabled={count >= cap} onClick={() => setN(count + 1)}>
              <Plus aria-hidden />
            </Button>
          </div>
          <Button size="lg" className="max-md:h-11" disabled={!canWrite || ticked.size === 0} onClick={run}>
            {t("action.pick.n", { n: count })}
          </Button>
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          className="h-9 ps-8 max-md:h-11"
          placeholder={t("custom.search")}
          aria-label={t("custom.search")}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {groups.map(({ g, players }) => {
          const on = players.filter((p) => ticked.has(p.id)).length;
          return (
            <Label key={g} className="min-h-9 gap-2 max-md:min-h-11">
              <Checkbox
                checked={on === 0 ? false : on === players.length ? true : "indeterminate"}
                disabled={players.length === 0}
                onCheckedChange={() => toggle(players.map((p) => p.id), on < players.length)}
              />
              {label(g)}
              <span className="text-meta text-muted-foreground tabular-nums">
                {on}/{players.length}
              </span>
            </Label>
          );
        })}
      </div>
      <ScrollArea className="-mx-2 h-72 max-md:h-[40dvh]">
        <div className="flex flex-col gap-3 px-2">
          {groups.map(({ g, players }) => {
            const shown = needle ? players.filter((p) => p.kick_username.toLowerCase().includes(needle)) : players;
            if (shown.length === 0) return null;
            return (
              <section key={g} aria-label={label(g)} className="flex flex-col">
                <h3 className="py-1 text-meta text-muted-foreground">{label(g)}</h3>
                {shown.map((p) => (
                  <Label key={p.id} className="min-h-9 gap-2.5 rounded-md px-1 font-normal hover:bg-muted max-md:min-h-11">
                    <Checkbox checked={ticked.has(p.id)} onCheckedChange={(c) => toggle([p.id], c === true)} />
                    <span className="truncate">{p.kick_username}</span>
                  </Label>
                ))}
              </section>
            );
          })}
          {needle && groups.every(({ players }) => !players.some((p) => p.kick_username.toLowerCase().includes(needle))) && (
            <p className="py-6 text-center text-meta text-muted-foreground">{t("custom.none")}</p>
          )}
        </div>
      </ScrollArea>
    </ResponsiveDialog>
  );
}
