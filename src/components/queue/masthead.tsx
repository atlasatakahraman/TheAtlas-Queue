"use client";
import { useT } from "@/components/i18n";
import { useQueue } from "@/components/queue/store";
import { Toolbar } from "@/components/queue/toolbar";
import { enter, useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";

// DESIGN.md § Pages → Dashboard: the dateline (channel, day, live state, waiting) and, right, the
// toolbar every tab shares (August's title row). The title is the top bar's typed wordmark.
export function Masthead() {
  const { t, lang } = useT();
  const ui = useUi();
  const name = useQueue((v) => v.channel.display_name);
  const liveSince = useQueue((v) => v.channel.live_since);
  const role = useQueue((v) => v.role);
  const waiting = useQueue((v) => v.players.filter((p) => p.status === "waiting").length);
  const subtitle = t("brand.subtitle");

  const [e0, e1] = [enter(ui.entering, 0), enter(ui.entering, 1)];
  const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const time = liveSince && new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(liveSince));

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-1">
        {/* No big channel title (owner, 2026-09-23): it repeated the top bar's wordmark. The
            channel leads the dateline; the heading stays for screen readers. */}
        <h1 className="sr-only">{name} · Queue</h1>
        {role === "mod" && (
          <span className="inline-flex self-start rounded-full border border-muted-foreground/45 px-2 text-caption tracking-normal text-muted-foreground select-none">
            {t("masthead.moderating")}
          </span>
        )}
        {subtitle && <p className="text-body text-muted-foreground">{subtitle}</p>}
        <p style={e0.style} className={cn("text-meta text-muted-foreground", e0.className)}>
          <span className="font-semibold text-foreground">{name}</span>
          {" · "}
          <span suppressHydrationWarning>{day}</span>
          {" · "}
          {time ? t("dateline.live", { time }) : t("dateline.offline")}
          {" · "}
          {t("dateline.waiting", { n: waiting })}
        </p>
      </div>
      <div style={e1.style} className={e1.className}>
        <Toolbar />
      </div>
    </header>
  );
}
