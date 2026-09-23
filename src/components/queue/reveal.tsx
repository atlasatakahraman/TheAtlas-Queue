"use client";
import { useEffect, useMemo } from "react";
import { useT } from "@/components/i18n";
import { ResponsiveDialog } from "@/components/queue/responsive-dialog";
import { useQueue, useStore } from "@/components/queue/store";
import { LandingName, revealOrder, useRevealMotion } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";

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
  const motion = useRevealMotion();
  const pick = reveal?.kind === "pick" ? reveal : null;
  const order = useMemo(() => revealOrder([pick?.result.picked ?? []]), [pick]);
  return (
    <ResponsiveDialog open={!!pick} onOpenChange={(o) => !o && store.clearReveal()} title={t("action.pick")}>
      <div className="flex flex-col gap-1.5">
        {order.map((o) => (
          <LandingName key={o.entry.id} entry={o.entry} at={motion ? o.at : 0} />
        ))}
      </div>
    </ResponsiveDialog>
  );
}
