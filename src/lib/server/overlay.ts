import "server-only";
import { cache } from "react";
import { adminDb } from "@/lib/server/admin-db";
import type { OverlaySnapshot } from "@/types/queue";

// /overlay's payload (0031, a whitelist built in the database), or null for an unknown, rotated or
// deleted key. One read per request.
export const overlaySnapshot = cache(async (key: string): Promise<OverlaySnapshot | null> => {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const { data, error } = await adminDb().rpc("overlay_snapshot", { p_key: key });
  if (error) throw new Error(`overlay_snapshot: ${error.code ?? "unknown"}`);
  return (data as OverlaySnapshot | null) ?? null;
});
