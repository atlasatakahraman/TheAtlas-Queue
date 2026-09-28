"use client";
import { useT } from "@/components/i18n";
import { useQueue } from "@/components/queue/store";
import { Toolbar } from "@/components/queue/toolbar";
import { enter, useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";
import { MASTHEAD } from "@/components/queue/geometry";

// DESIGN.md § Pages → Dashboard: the streamer's subtitle, if set, and right, the toolbar every tab
// shares (August's title row). The channel and *Moderating* are in the top bar's breadcrumb; the
// dateline went with D21 (owner, 2026-09-27).
export function Masthead() {
  const { t } = useT();
  const ui = useUi();
  const name = useQueue((v) => v.channel.display_name);
  const subtitle = t("brand.subtitle");
  const [e0, e1] = [enter(ui.entering, 0), enter(ui.entering, 1)];

  return (
    <header className={MASTHEAD}>
      <div className="flex min-w-0 flex-col gap-1">
        {/* No big channel title (owner, 2026-09-23): the top bar names the channel; the heading
            stays for screen readers. */}
        <h1 className="sr-only">{name} · Queue</h1>
        {subtitle && (
          <p style={e0.style} className={cn("text-body text-muted-foreground", e0.className)}>
            {subtitle}
          </p>
        )}
      </div>
      <div style={e1.style} className={e1.className}>
        <Toolbar />
      </div>
    </header>
  );
}
