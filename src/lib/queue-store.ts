"use client";
import { db } from "@/lib/supabase/browser";
import type { Activity, ChangeEvent, Draw, Member, Player, QueueState, Row, Sanction } from "@/types/queue";

// The dashboard's client state (spec § Realtime → Client store). get_state seeds it; events on
// ch:<channel_id> move it one version at a time: v == local+1 applies, v <= local is an echo of
// something already applied, a gap refetches. Every RPC's return value is its event, so an own
// action applies the moment the call returns and its broadcast echo is dropped.

export type Conn = "connecting" | "live" | "down";

export type QueueView = QueueState & {
  conn: Conn;
  online: boolean;
  lost: boolean; // access removed while the page was open
  arrived: Record<string, number>; // player id → when a realtime arrival landed
  reverted: Record<string, number>; // player id → when a failed action put it back
  reveal: Draw | null; // a draw this device has not played yet
};

export type RpcError = { key: string; detail: Record<string, unknown> };

const PLAYED_KEY = "queue.played-draws";
const REVEAL_WINDOW_MS = 30_000;

function played(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function markPlayed(id: string) {
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([id, ...played().filter((x) => x !== id)].slice(0, 20)));
  } catch {}
}

const byJoined = (a: Player, b: Player) => a.joined_at.localeCompare(b.joined_at);

function upsert<T>(list: T[], row: T, same: (x: T) => boolean): T[] {
  const i = list.findIndex(same);
  if (i < 0) return [...list, row];
  const next = list.slice();
  next[i] = { ...list[i], ...row };
  return next;
}

function toError(e: { code?: string; message: string; details?: string | null }): RpcError {
  if (e.code !== "P0001") return { key: e.code ? "generic" : "network", detail: {} };
  let detail: Record<string, unknown> = {};
  try {
    detail = e.details ? JSON.parse(e.details) : {};
  } catch {}
  return { key: e.message, detail };
}

export function createQueueStore(initial: QueueState, me: number) {
  let view: QueueView = {
    ...initial,
    conn: "connecting",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    lost: false,
    arrived: {},
    reverted: {},
    reveal: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: QueueView) => {
    view = next;
    listeners.forEach((l) => l());
  };
  const channelId = initial.channel.id;

  // A draw row this device should reveal: standing, fresh, not yet played here.
  const revealable = (d: Draw) =>
    !d.undone_at && Date.now() - Date.parse(d.created_at) < REVEAL_WINDOW_MS && !played().includes(d.id);

  function merge(v: QueueView, rows: Row[], remote: boolean): QueueView {
    let next = { ...v };
    const now = Date.now();
    for (const r of rows) {
      switch (r._t) {
        case "players": {
          const p = r as unknown as Player;
          const had = next.players.some((x) => x.id === p.id);
          if (p.deleted_at) next.players = next.players.filter((x) => x.id !== p.id);
          else {
            next.players = upsert(next.players, p, (x) => x.id === p.id).sort(byJoined);
            if (!had && remote) next.arrived = { ...next.arrived, [p.id]: now };
          }
          break;
        }
        case "draws": {
          const d = r as unknown as Draw;
          if (d.undone_at) {
            if (next.draw?.id === d.id) next.draw = null;
            if (next.reveal?.id === d.id) next.reveal = null;
          } else if (!next.draw || next.draw.id === d.id || d.created_at >= next.draw.created_at) {
            const isNew = next.draw?.id !== d.id;
            next.draw = d;
            if (isNew && revealable(d)) next.reveal = d;
          }
          break;
        }
        case "moderation": {
          const m = r as unknown as Sanction;
          next.moderation = r._deleted
            ? next.moderation.filter((x) => x.id !== m.id)
            : upsert(next.moderation, m, (x) => x.id === m.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
          break;
        }
        case "respect":
          next.respect = { ...next.respect, [String(r.kick_username).toLowerCase()]: Number(r.points) };
          break;
        case "settings":
          next.settings = { ...next.settings, ...(r as object) };
          break;
        case "channels":
          next.channel = { ...next.channel, ...(r as object) };
          break;
        case "channel_members": {
          const m = r as unknown as Member;
          next.members = r._deleted
            ? next.members.filter((x) => x.kick_user_id !== m.kick_user_id)
            : upsert(next.members, m, (x) => x.kick_user_id === m.kick_user_id);
          break;
        }
        case "activity": {
          const a = r as unknown as Activity;
          next.activity = upsert(next.activity, a, (x) => x.id === a.id)
            .sort((x, y) => y.id - x.id)
            .slice(0, 100);
          break;
        }
      }
    }
    // The removal event also closes a removed moderator's client (spec § Realtime, known limit).
    const mine = next.members.find((m) => m.kick_user_id === me);
    if (!mine || mine.blocked) next = { ...next, lost: true };
    return next;
  }

  let inflight: Promise<void> | undefined;
  function refetch(): Promise<void> {
    inflight ??= (async () => {
      const { data, error } = await db().rpc("get_state", { p_channel: channelId });
      if (error) {
        if (toError(error).key === "auth.not_member") set({ ...view, lost: true });
        return;
      }
      const s = data as QueueState;
      // A draw that landed while this tab was away still reveals if it is fresh.
      const reveal = s.draw && s.draw.id !== view.draw?.id && revealable(s.draw) ? s.draw : view.reveal;
      set({ ...view, ...s, reveal });
    })().finally(() => (inflight = undefined));
    return inflight;
  }

  function apply(ev: ChangeEvent, remote: boolean) {
    if (ev.kind === "draw_stale") return set(merge(view, ev.rows, true));
    if (ev.v <= view.v) return;
    if (ev.v > view.v + 1) return void refetch();
    set({ ...merge(view, ev.rows, remote), v: ev.v });
  }

  // Calls a member RPC with a request_id; one automatic retry with the same id on a network
  // error (the server replays it once at most). Returns the event or the error key.
  async function call(rpc: string, args: Record<string, unknown>): Promise<ChangeEvent | RpcError> {
    const params = { p_channel: channelId, ...args, p_request_id: crypto.randomUUID() };
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await db().rpc(rpc, params);
      if (!error) {
        const ev = data as ChangeEvent;
        apply(ev, false);
        return ev;
      }
      const e = toError(error);
      if (e.key !== "network" || attempt === 1) return e;
    }
  }

  // Optimistic change to the player list, before the call returns. A failure refetches the
  // truth and marks the rows so they come back with the highlight.
  function optimistic(ids: string[], patch: (p: Player) => Player | null) {
    set({
      ...view,
      players: view.players.flatMap((p) => {
        if (!ids.includes(p.id)) return [p];
        const q = patch(p);
        return q ? [q] : [];
      }),
    });
  }
  async function revert(ids: string[]) {
    await refetch();
    const now = Date.now();
    set({ ...view, reverted: { ...view.reverted, ...Object.fromEntries(ids.map((id) => [id, now])) } });
  }

  function connect(): () => void {
    const topic = db()
      .channel(`ch:${channelId}`, { config: { private: true } })
      .on("broadcast", { event: "change" }, ({ payload }) => apply(payload as ChangeEvent, true));
    let closed = false;
    void db().realtime.setAuth().then(() => {
      if (closed) return;
      topic.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          set({ ...view, conn: "live" });
          void refetch();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          set({ ...view, conn: "down" });
        }
      });
    });
    const onOnline = () => {
      set({ ...view, online: true });
      void refetch();
    };
    const onOffline = () => set({ ...view, online: false });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      void db().removeChannel(topic);
    };
  }

  return {
    get: () => view,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    connect,
    refetch,
    call,
    optimistic,
    revert,
    clearReveal: () => {
      if (view.reveal) markPlayed(view.reveal.id);
      set({ ...view, reveal: null });
    },
  };
}

export type QueueStore = ReturnType<typeof createQueueStore>;

export function isError(r: ChangeEvent | RpcError): r is RpcError {
  return "key" in r;
}
