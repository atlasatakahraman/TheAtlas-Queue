"use client";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { isLabelKey, type LabelKey, type Vars } from "@/lib/i18n";
import { createQueueStore, isError, type QueueStore, type QueueView, type RpcError } from "@/lib/queue-store";
import type { ChangeEvent, Player, QueueState } from "@/types/queue";

const Ctx = createContext<QueueStore | null>(null);

export function QueueProvider({ initial, me, children }: { initial: QueueState; me: number; children: React.ReactNode }) {
  const [store] = useState(() => createQueueStore(initial, me));
  useEffect(() => store.connect(), [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): QueueStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside QueueProvider");
  return s;
}

// Selectors must return something already in the view (or a primitive), never a new array.
export function useQueue<T>(select: (v: QueueView) => T): T {
  const s = useStore();
  return useSyncExternalStore(s.subscribe, () => select(s.get()), () => select(s.get()));
}

// Data-changing actions are disabled, not queued, while offline or disconnected
// (DESIGN.md § States → Offline).
export function useCanWrite(): boolean {
  return useQueue((v) => v.online && v.conn === "live" && !v.lost);
}

export function useErrorText() {
  const { t } = useT();
  return useCallback(
    (e: RpcError) => {
      if (e.key === "undo.changed") {
        return e.detail.by ? t("error.undo.changed", { by: String(e.detail.by) }) : t("error.undo.changed.anon");
      }
      const key = `error.${e.key}`;
      return isLabelKey(key) ? t(key, { name: String(e.detail.name ?? "") }) : t("error.generic");
    },
    [t],
  );
}

type ActOptions = {
  // Players changed before the call returns; a failure brings them back highlighted.
  optimistic?: { ids: string[]; patch: (p: Player) => Player | null };
  // Success toast with Undo (DESIGN.md § Undo, not confirm).
  done?: LabelKey;
  vars?: Vars;
};

// One place every dashboard write goes through: request_id, optimistic change, error toast with
// Retry, success toast with Undo. Events from chat never reach here, so they never toast.
export function useAct() {
  const store = useStore();
  const { t } = useT();
  const errorText = useErrorText();

  return useCallback(
    async function act(rpc: string, args: Record<string, unknown>, opts: ActOptions = {}): Promise<ChangeEvent | RpcError> {
      const v = store.get();
      if (!v.online || v.conn !== "live" || v.lost) return { key: "network", detail: {} };
      if (opts.optimistic) store.optimistic(opts.optimistic.ids, opts.optimistic.patch);
      const r = await store.call(rpc, args);
      if (isError(r)) {
        if (opts.optimistic) void store.revert(opts.optimistic.ids);
        toast.error(r.key === "network" ? t("error.network") : errorText(r), {
          action: { label: t("common.retry"), onClick: () => void act(rpc, args, opts) },
        });
        if (process.env.NODE_ENV !== "production") console.error(rpc, r);
        return r;
      }
      const activity = r.rows.find((row) => row._t === "activity");
      if (opts.done && activity && r.kind !== "replay") {
        toast(t(opts.done, opts.vars), {
          duration: 5000,
          action: {
            label: t("common.undo"),
            onClick: () => void act("undo", { p_activity: activity.id }),
          },
        });
      }
      return r;
    },
    [store, t, errorText],
  );
}
