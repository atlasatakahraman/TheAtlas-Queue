import { watchSnapshot } from "@/lib/server/watch";

// Viewers refetch here on a `watch:<slug>` ping (spec § Realtime). The CDN keeps a response for a
// second and serves it stale for five while it refreshes, so a channel costs about one database
// read a second whatever the audience; browsers never keep it.
const CACHE = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "CDN-Cache-Control": "max-age=1, stale-while-revalidate=5",
};

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snap = await watchSnapshot(slug);
  if (!snap) return Response.json({ error: "not_found" }, { status: 404, headers: CACHE });
  return Response.json(snap, { headers: { ...CACHE, "X-Robots-Tag": "noindex" } });
}
