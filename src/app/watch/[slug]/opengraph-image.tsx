import "server-only";
import { translate } from "@/lib/i18n";
import { OG_SIZE, ogImage } from "@/lib/server/og";
import { watchSnapshot } from "@/lib/server/watch";

export const size = OG_SIZE;
export const contentType = "image/png";

// The channel and its team names (the streamer's own labels), in the stream's words.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const snap = await watchSnapshot((await params).slug);
  const labels = snap?.labels ?? undefined;
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate("en", k, labels, vars);
  const name = snap?.channel.name ?? "";
  return ogImage({
    title: t("watch.title", { channel: name }),
    teams: snap && !snap.disabled ? { a: t("team.1"), vs: t("match.vs"), b: t("team.2") } : undefined,
    foot: t("watch.subtitle"),
  });
}
