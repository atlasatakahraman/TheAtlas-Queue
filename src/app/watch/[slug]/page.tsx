import "server-only";
import { EyeOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBlock, StatusPage } from "@/components/status-page";
import { Button } from "@/components/ui/button";
import { WatchView } from "@/components/watch/watch-view";
import { translate } from "@/lib/i18n";
import { alternates, ogLocale, requestLang } from "@/lib/server/site";
import { watchSnapshot } from "@/lib/server/watch";

type Props = { params: Promise<{ slug: string }> };

const NOINDEX = { index: false, follow: false };

// DESIGN.md § Metadata and SEO: "{Channel}'s queue", indexed while the page is on.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const snap = await watchSnapshot((await params).slug);
  if (!snap) return { title: "404", robots: NOINDEX };
  const lang = await requestLang();
  const channel = snap.channel.name;
  const title = translate(lang, "watch.title", snap.labels ?? undefined, { channel });
  if (snap.disabled) return { title, robots: NOINDEX };
  const description = translate(lang, "watch.description", undefined, { channel });
  const path = `/watch/${snap.channel.slug}`;
  return { title, description, alternates: await alternates(path), openGraph: { title, description, url: path, ...ogLocale(lang) } };
}

// /watch/<channel> (DESIGN.md § /watch): a real 404 for a channel that does not exist; the
// streamer's own words, noindex, when the page is off.
export default async function WatchPage({ params }: Props) {
  const snap = await watchSnapshot((await params).slug);
  if (!snap) notFound();
  if (snap.disabled) {
    const lang = await requestLang();
    const t = (k: Parameters<typeof translate>[1]) => translate(lang, k, snap.labels);
    return (
      <StatusPage crumb={snap.channel.name}>
        <StatusBlock
          mark={<EyeOff className="size-16 text-muted-foreground" aria-hidden />}
          title={t("watch.disabled")}
          hint={t("watch.disabled.hint")}
          actions={
            <Button asChild size="lg" variant="outline">
              <Link href="/">{t("notfound.home")}</Link>
            </Button>
          }
        />
      </StatusPage>
    );
  }
  return <WatchView slug={snap.channel.slug} initial={snap} />;
}
