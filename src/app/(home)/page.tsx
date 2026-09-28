import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Home } from "@/components/home";
import { AUTO_COOKIE, CONTINUE_COOKIE, CONTINUE_PATH } from "@/components/queue/tabs";
import { type Place, type Resume, SelectPage } from "@/components/select";
import { adminDb } from "@/lib/server/admin-db";
import { auth } from "@/lib/auth";
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";
import { translate } from "@/lib/i18n";
import { alternates, ogLocale, requestLang, SITE } from "@/lib/server/site";

type Props = { searchParams: Promise<{ callbackUrl?: string; pick?: string }> };

// DESIGN.md § Metadata and SEO: the one indexed page besides /watch.
export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  const title = translate(lang, "seo.home.title");
  const description = translate(lang, "seo.home.description");
  return {
    title: { absolute: title },
    description,
    alternates: await alternates("/"),
    openGraph: { title, description, url: "/", ...ogLocale(lang) },
  };
}

// Structured data (DESIGN.md § Structured data): what the site is, and its name for results.
function JsonLd({ lang }: { lang: "en" | "tr" }) {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "TheAtlas Queue",
      url: SITE,
      description: translate(lang, "seo.home.description"),
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      inLanguage: ["en", "tr"],
    },
    { "@context": "https://schema.org", "@type": "WebSite", name: "TheAtlas Queue", url: SITE },
  ];
  // Rendered on the server; < escaped so a string can never close the script.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

// Only same-site paths: an open redirect would hand a signed-in user to anyone's page. Parsed
// the way a browser reads Location, which drops tabs and newlines ("/\t/evil.com" is //evil.com).
function safePath(p: string | undefined): string | null {
  if (typeof p !== "string" || !p.startsWith("/")) return null;
  const base = "http://queue.invalid";
  const u = URL.parse(p, base);
  return u && u.origin === base ? u.pathname + u.search + u.hash : null;
}

// `/` (spec D11, amended by D19): signed out, the home page, which is also the sign-in page;
// signed in, the selection page (DESIGN.md § Selection page). With Open this automatically on, the
// place last left opens straight away, from the server so nothing flashes; ?pick (the dashboards'
// way back) never redirects.
export default async function RootPage({ searchParams }: Props) {
  const q = await searchParams;
  const callbackUrl = safePath(q.callbackUrl);
  const session = await auth();
  const user = kickUser(session);
  if (!user)
    return (
      <>
        <JsonLd lang={await requestLang()} />
        <Home callbackUrl={callbackUrl ?? "/"} />
      </>
    );
  if (callbackUrl && callbackUrl !== "/") redirect(callbackUrl);

  const jar = await cookies();
  const last = CONTINUE_PATH.exec(decodeURIComponent(jar.get(CONTINUE_COOKIE)?.value ?? ""));
  const auto = jar.get(AUTO_COOKIE)?.value === "1";

  const profileId = await ensureProfile(session);
  const db = userDb(profileId!);
  const { data } = await db
    .from("channel_members")
    .select("role, channels(id, slug, display_name, live_since, settings(watch_enabled))")
    .eq("kick_user_id", user.kickUserId)
    .eq("blocked", false);
  type Row = { id: string; slug: string; display_name: string; live_since: string | null; settings: { watch_enabled: boolean } | null };
  const rows = (data ?? []).flatMap((m) => {
    const c = m.channels as unknown as Row | null;
    return c ? [{ role: m.role as "owner" | "mod", c }] : [];
  });
  // Nobody's channel yet: onboarding, as before D19 (the selection page would be empty).
  if (rows.length === 0 && !last) redirect("/welcome");
  const { data: waiting } = rows.length
    ? await db.from("players").select("channel_id").in("channel_id", rows.map((r) => r.c.id)).eq("status", "waiting").is("deleted_at", null)
    : { data: [] };
  const count = (id: string) => (waiting ?? []).filter((p) => p.channel_id === id).length;
  const channels: Place[] = rows
    .map(({ role, c }) => ({
      slug: c.slug,
      name: c.display_name,
      role,
      live: !!c.live_since,
      waiting: count(c.id),
      watch: !!c.settings?.watch_enabled,
    }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "owner" ? -1 : 1));

  let resume: Resume | null = null;
  if (last) {
    const [, kind, slug] = last;
    if (kind === "c") {
      const mine = channels.find((c) => c.slug === slug);
      resume = { kind: "manage", slug, name: mine?.name ?? null, live: !!mine?.live, waiting: mine?.waiting ?? null };
    } else {
      // A watch page may be any channel's: read as the server, only what /watch shows anyway.
      const { data: c } = await adminDb().from("channels").select("display_name, live_since, settings(watch_enabled)").eq("slug", slug).maybeSingle();
      const on = (c?.settings as unknown as { watch_enabled: boolean } | null)?.watch_enabled;
      resume = { kind: "watch", slug, name: c && on ? c.display_name : null, live: !!c?.live_since, waiting: null };
    }
    if (auto && resume.name !== null && q.pick === undefined) redirect(resume.kind === "manage" ? `/c/${slug}` : `/watch/${slug}`);
  }
  return <SelectPage account={{ name: user.username, image: user.image ?? null }} channels={channels} resume={resume} auto={auto} />;
}
