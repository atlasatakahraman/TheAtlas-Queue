import { overlaySnapshot } from "@/lib/server/overlay";

// The overlay refetches here on a `watch:<slug>` ping, cached at the CDN as /api/watch is. A
// rotated key answers 404 once the CDN's copy (a second, five stale) is gone.
const CACHE = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "CDN-Cache-Control": "max-age=1, stale-while-revalidate=5",
  "X-Robots-Tag": "noindex",
};

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const snap = await overlaySnapshot((await params).key);
  if (!snap) return Response.json({ error: "not_found" }, { status: 404, headers: CACHE });
  return Response.json(snap, { headers: CACHE });
}
