import "server-only";
import type { MetadataRoute } from "next";
import { TOPICS, topicPath } from "@/lib/help";
import { adminDb } from "@/lib/server/admin-db";
import { SITE } from "@/lib/server/site";

// Read per request: the build has no secret key, and pages turn on and off.
export const dynamic = "force-dynamic";

// Exactly the indexed pages (DESIGN.md § Indexing): home, the help pages and every enabled /watch.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await adminDb().rpc("watch_sitemap");
  const pages = (data ?? []) as { slug: string; updated_at: string | null }[];
  return [
    { url: SITE, changeFrequency: "monthly", priority: 1 },
    ...TOPICS.map((t) => ({ url: `${SITE}${topicPath(t)}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...pages.map((p) => ({
      url: `${SITE}/watch/${p.slug}`,
      lastModified: p.updated_at ?? undefined,
      changeFrequency: "daily" as const,
    })),
  ];
}
