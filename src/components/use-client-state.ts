"use client";
import { useCallback, useSyncExternalStore } from "react";

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

const mediaSubs = new Map<string, (cb: () => void) => () => void>();
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
