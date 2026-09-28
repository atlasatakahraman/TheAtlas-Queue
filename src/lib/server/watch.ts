import "server-only";
import { cache } from "react";
import { adminDb } from "@/lib/server/admin-db";
import type { WatchSnapshot } from "@/types/queue";

// /watch's payload (0029, a whitelist built in the database), or null for an unknown channel.
// One read per request: the page and its metadata share it.
export const watchSnapshot = cache(async (slug: string): Promise<WatchSnapshot | null> => {
  const { data, error } = await adminDb().rpc("watch_snapshot", { p_slug: slug });
  if (error) throw new Error(`watch_snapshot: ${error.code ?? "unknown"}`);
  return (data as WatchSnapshot | null) ?? null;
});
