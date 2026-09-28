"use client";
import { useEffect, useRef, useState } from "react";
import type { WatchSnapshot } from "@/types/queue";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// The live /watch snapshot. `watch:<slug>` is a public Realtime topic that carries only {v}
// (spec § Realtime): a hint to refetch the cached /api/watch, never data. Joined over a bare
// WebSocket (Phoenix protocol, as supabase-js speaks it) so /watch ships no Supabase client.
// A snapshot older than the ping retries once after a second (the CDN may still hold the last
// one); a refocus and a minute's quiet refetch too, which also catch the page being turned off.
export function useWatch(slug: string, initial: WatchSnapshot): WatchSnapshot {
  const [snap, setSnap] = useState(initial);
  const v = useRef(initial.disabled ? 0 : initial.v);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | undefined;
    let beat: ReturnType<typeof setInterval> | undefined;
    let tries = 0;

    const load = async (want = 0, again = true) => {
      const r = await fetch(`/api/watch/${encodeURIComponent(slug)}`).catch(() => null);
      if (!r || closed || (!r.ok && r.status !== 404)) return;
      const s = r.ok ? ((await r.json()) as WatchSnapshot) : null;
      if (closed || !s) return;
      if (s.disabled) setSnap(s);
      else if (s.v >= v.current) {
        v.current = s.v;
        setSnap(s);
      }
      if (want > (s.disabled ? 0 : s.v) && again) setTimeout(() => void load(want, false), 1000);
    };

    const connect = () => {
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
  }, [slug]);

  return snap;
}
