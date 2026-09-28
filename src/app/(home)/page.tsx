import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Home } from "@/components/home";
import { LAST_CHANNEL_COOKIE } from "@/components/queue/tabs";
import { auth } from "@/lib/auth";
import { ensureProfile, kickUser } from "@/lib/server/profile";
import { userDb } from "@/lib/server/user-db";
import { translate } from "@/lib/i18n";
import { alternates, ogLocale, requestLang, SITE } from "@/lib/server/site";

type Props = { searchParams: Promise<{ callbackUrl?: string }> };

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

// `/` (spec D11): signed out, the home page, which is also the sign-in page; signed in, the
// streamer's own channel, else the last channel they opened, else any they moderate, else
// onboarding.
export default async function RootPage({ searchParams }: Props) {
  const callbackUrl = safePath((await searchParams).callbackUrl);
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

  const profileId = await ensureProfile(session);
  const { data } = await userDb(profileId!)
    .from("channel_members")
    .select("role, channels(slug)")
    .eq("kick_user_id", user.kickUserId)
    .eq("blocked", false);
  const slugs = (data ?? []).map((m) => ({
    role: m.role as string,
    slug: (m.channels as unknown as { slug: string } | null)?.slug,
  }));
  const last = (await cookies()).get(LAST_CHANNEL_COOKIE)?.value;
  const target =
    slugs.find((m) => m.role === "owner")?.slug ?? slugs.find((m) => m.slug === last)?.slug ?? slugs[0]?.slug;
  redirect(target ? `/c/${target}` : "/welcome");
}
