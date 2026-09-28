"use client";
import { useEffect, useRef, useState } from "react";
import type { WatchSnapshot } from "@/types/queue";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// A snapshot's version; a page that is off (/watch disabled) has none and is always taken.
const ver = (s: object) => ("v" in s && typeof s.v === "number" ? s.v : 0);

// A live public snapshot. `watch:<slug>` is a public Realtime topic that carries only {v}
// (spec § Realtime): a hint to refetch the cached `url`, never data. Joined over a bare WebSocket
// (Phoenix protocol, as supabase-js speaks it) so the public pages ship no Supabase client. A
// snapshot older than the ping retries once after a second (the CDN may still hold the last
// one); a refocus and a minute's quiet refetch too. A 404 is null: the overlay's key was rotated
// or deleted (/watch keeps what it has).
export function useLive<T extends object>(slug: string | null, url: string, initial: T | null): T | null {
  const [snap, setSnap] = useState(initial);
  const v = useRef(initial ? ver(initial) : 0);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | undefined;
    let beat: ReturnType<typeof setInterval> | undefined;
    let tries = 0;

    const load = async (want = 0, again = true) => {
      const r = await fetch(url).catch(() => null);
      if (!r || closed || (!r.ok && r.status !== 404)) return;
      const s = r.ok ? ((await r.json()) as T) : null;
      if (closed) return;
      if (!s) return setSnap(null);
      const sv = ver(s);
      if (sv === 0 || sv >= v.current) {
        v.current = sv;
        setSnap(s);
      }
      if (want > sv && again) setTimeout(() => void load(want, false), 1000);
    };

    const connect = () => {
      if (!slug) return;
      ws = new WebSocket(`${URL_BASE.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${KEY}&vsn=1.0.0`);
      const topic = `realtime:watch:${slug}`;
      let ref = 0;
      const send = (t: string, event: string, payload: object) => ws?.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref) }));
      ws.onopen = () => {
        tries = 0;
        send(topic, "phx_join", { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [], private: false } });
        beat = setInterval(() => send("phoenix", "heartbeat", {}), 25_000);
        void load();
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data)) as { event: string; payload?: { event?: string; payload?: { v?: number } } };
        const pv = msg.event === "broadcast" && msg.payload?.event === "ping" ? Number(msg.payload.payload?.v) : 0;
        if (pv > v.current) void load(pv);
      };
      ws.onclose = () => {
        clearInterval(beat);
        if (!closed) setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++));
      };
    };

    connect();
    const idle = setInterval(() => void load(), 60_000);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      closed = true;
      clearInterval(idle);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onShow);
      ws?.close();
    };
  }, [slug, url]);

  return snap;
}

// The live /watch snapshot; a channel that vanished while open keeps its first paint.
export function useWatch(slug: string, initial: WatchSnapshot): WatchSnapshot {
  return useLive(slug, `/api/watch/${encodeURIComponent(slug)}`, initial) ?? initial;
}
