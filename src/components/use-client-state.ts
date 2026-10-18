"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

// Browser-only state that must not break hydration: the server snapshot is the default, and the
// real value arrives in the client's first update.

const storeSubs = new Set<() => void>();
function subscribeStorage(cb: () => void) {
  storeSubs.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    storeSubs.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

// A per-device preference in localStorage (spec § Data model: queue filter, mod subtab).
export function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        const v = localStorage.getItem(key) as T | null;
        return v && allowed.includes(v) ? v : fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      storeSubs.forEach((f) => f());
    },
    [key],
  );
  return [value, set];
}

// A per-device list of player ids (Custom pick's pool). The snapshot is the raw string, since
// useSyncExternalStore needs a stable value; anything that is not an array of UUIDs reads as
// empty, and the list stops at 512, pick_players' own cap (0045).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_STORED_IDS = 512;

export function useStoredIds(key: string): [readonly string[], (ids: readonly string[]) => void] {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const ids = useMemo(() => {
    try {
      const v: unknown = JSON.parse(raw ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, MAX_STORED_IDS) : [];
    } catch {
      return [];
    }
  }, [raw]);
  const set = useCallback(
    (v: readonly string[]) => {
      try {
        localStorage.setItem(key, JSON.stringify(v.slice(0, MAX_STORED_IDS)));
      } catch {}
      storeSubs.forEach((f) => f());
    },
    [key],
  );
  return [ids, set];
}

export const customPoolKey = (channelId: string) => `queue.custom-pool.${channelId}`;

const mediaSubs =new Map<string, (cb: () => void) => () => void>();
function media(query: string) {
  let sub = mediaSubs.get(query);
  if (!sub) {
    sub = (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    };
    mediaSubs.set(query, sub);
  }
  return sub;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(media(query), () => window.matchMedia(query).matches, () => false);
}

// Under 768px dialogs become bottom sheets (DESIGN.md § Mobile).
export const useIsMobile = () => useMedia("(max-width: 767px)");
// No hover: the Riot hover card becomes a popover on tap.
export const useIsTouch = () => useMedia("(hover: none)");
