import "server-only";
import type { MetadataRoute } from "next";
import { indexable, SITE } from "@/lib/server/site";

// DESIGN.md § Indexing: /api/ is off limits; pages that must not be indexed say so themselves
// (Google has to crawl a page to read its noindex). A preview or a laptop disallows everything.
export default function robots(): MetadataRoute.Robots {
  if (!indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${SITE}/sitemap.xml` };
}
