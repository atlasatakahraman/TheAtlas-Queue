"use client";
import { useEffect, useState } from "react";
import { I18nProvider, useT } from "@/components/i18n";
import { Typed } from "@/components/prefs";
import { REVEAL, revealOrder } from "@/components/queue/reveal-order";
import { useLive } from "@/components/watch/use-watch";
import { cn } from "@/lib/utils";
import type { OverlayConfig, OverlaySnapshot, OverlayWidget } from "@/types/queue";

// Each theme's panel, text and team colours, from the literal palette: the overlay sits on
// unknown video, so it never follows the site's theme (DESIGN.md § /overlay/<key>).
const THEMES = {
  ink: {
    "--o-panel": "color-mix(in srgb, var(--ink-floor) 88%, transparent)",
    "--o-floor": "var(--ink-floor)",
    "--o-text": "var(--ink-text)",
    "--o-muted": "var(--ink-muted)",
    "--o-gold": "var(--ink-gold)",
    "--o-t1": "var(--ink-teal)",
    "--o-t2": "var(--ink-orange)",
  },
  paper: {
    "--o-panel": "color-mix(in srgb, var(--paper-card) 92%, transparent)",
    "--o-floor": "var(--paper-floor)",
    "--o-text": "var(--paper-text)",
    "--o-muted": "var(--paper-muted)",
    "--o-gold": "var(--paper-gold)",
    "--o-t1": "var(--paper-teal)",
    "--o-t2": "var(--paper-orange)",
  },
} as const;

// Where the widgets stand in the 1920×1080 canvas, 48px in from its edges; along the top and
// bottom edges they stand side by side.
const ANCHOR: Record<OverlayConfig["anchor"], string> = {
  "top-left": "items-start justify-start",
  top: "items-start justify-center",
  "top-right": "items-start justify-end",
  left: "items-center justify-start",
  right: "items-center justify-end",
  "bottom-left": "items-end justify-start",
  bottom: "items-end justify-center",
  "bottom-right": "items-end justify-end",
};
const ZOOM = { s: 0.8, m: 1, l: 1.25 };
// The reveal widget shows a new draw this long, then fades out.
const SHOWN = 20_000;

// /overlay/<key> (DESIGN.md § /overlay/<key>): no interaction, no cursor, no entrance; the
// widgets the streamer turned on, in their order. An unknown, rotated or deleted key draws
// nothing. Also the Settings builder's live preview, in a scaled frame.
export function OverlayView({ overlayKey, initial }: { overlayKey: string; initial: OverlaySnapshot | null }) {
  const snap = useLive(initial?.slug ?? null, `/api/overlay/${overlayKey}`, initial);
  return (
    <>
      {/* The page is see-through for OBS whatever the site's theme paints. */}
      <style>{`html,body{background:transparent!important;color-scheme:normal!important;overflow:hidden;scrollbar-gutter:auto!important}`}</style>
      {snap && (
        <I18nProvider key={snap.lang} lang={snap.lang} labels={snap.labels ?? undefined}>
          <Canvas snap={snap} overlayKey={overlayKey} />
        </I18nProvider>
      )}
    </>
  );
}

function Canvas({ snap, overlayKey }: { snap: OverlaySnapshot; overlayKey: string }) {
  const c = snap.config;
  const row = c.anchor === "top" || c.anchor === "bottom";
  const right = c.anchor.endsWith("right");
  return (
    <div
      aria-hidden
      style={THEMES[c.theme] as React.CSSProperties}
      className={cn("fixed inset-0 flex cursor-none p-12 text-(--o-text) select-none", ANCHOR[c.anchor], c.background === "solid" && "bg-(--o-floor)")}
    >
      <div
        style={{ zoom: ZOOM[c.size] }}
        className={cn("flex gap-6", row ? "flex-row items-start" : "flex-col", right && !row && "items-end", !right && !row && "items-start")}
      >
        {c.widgets.filter((w) => w.on).map((w) => (
          <Widget key={w.type} type={w.type} snap={snap} overlayKey={overlayKey} />
        ))}
      </div>
    </div>
  );
}

function Widget({ type, snap, overlayKey }: { type: OverlayWidget; snap: OverlaySnapshot; overlayKey: string }) {
  if (type === "teams") return <Teams snap={snap} />;
  if (type === "score") return <Score snap={snap} />;
  if (type === "reveal") return <Reveal snap={snap} overlayKey={overlayKey} />;
  if (type === "queue") return <Queue snap={snap} />;
  if (type === "last") return <Last snap={snap} />;
  if (type === "wins") return <Wins snap={snap} />;
  return <Board title="overlay.respect" rows={snap.respect?.map((r) => ({ name: r.name, value: String(r.respect), extra: null }))} />;
}

function Wins({ snap }: { snap: OverlaySnapshot }) {
  const { t } = useT();
  const rows = snap.wins?.map((r) => ({ name: r.name, value: t("overlay.wins.n", { n: r.wins }), extra: `${Math.round((100 * r.wins) / r.games)}%` }));
  return <Board title={snap.config.board_period === "stream" ? "overlay.wins.stream" : "overlay.wins.all"} rows={rows} />;
}

function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-[22rem] flex-col gap-3 rounded-xl bg-(--o-panel) px-6 py-5", className)}>
      {title && <h2 className="text-[1.5rem] leading-tight font-medium text-(--o-muted)">{title}</h2>}
      {children}
    </section>
  );
}

const tone = (team: 1 | 2) => (team === 1 ? "text-(--o-t1)" : "text-(--o-t2)");

function Name({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-overlay-name">
      <span className="truncate">{name}</span>
    </span>
  );
}

function Teams({ snap }: { snap: OverlaySnapshot }) {
  const { t } = useT();
  const players = snap.teams ?? [];
  if (players.length === 0) return null;
  return (
    <Panel className="grid min-w-[40rem] grid-cols-2 gap-x-10">
      {([1, 2] as const).map((n) => (
        <div key={n} className="flex min-w-0 flex-col gap-1.5">
          <h2 className={cn("font-serif text-[2.25rem] leading-tight", tone(n))}>{t(`team.${n}`)}</h2>
          {players.filter((p) => p.team === n).map((p) => (
            <Name key={p.id} name={p.kick_username} />
          ))}
        </div>
      ))}
    </Panel>
  );
}

function Score({ snap }: { snap: OverlaySnapshot }) {
  const { t } = useT();
  if (!snap.score) return null;
  return (
    <Panel className="min-w-0 w-fit">
      {/* The scores alone, each in its team's colour (owner, 2026-09-29); the names are the Teams widget's. */}
      <p className="flex items-baseline gap-5 font-serif text-overlay-headline">
        <span className="font-medium text-(--o-t1) tabular-nums">{snap.score.t1}</span>
        <span className="text-[1.5rem] text-(--o-muted) italic">{t("match.vs")}</span>
        <span className="font-medium text-(--o-t2) tabular-nums">{snap.score.t2}</span>
      </p>
    </Panel>
  );
}

// A new draw types its names in, holds, and fades out 20 seconds after it arrived. Each overlay
// plays a draw once, so an OBS reload does not replay it; one older than 30 seconds never plays.
function Reveal({ snap, overlayKey }: { snap: OverlaySnapshot; overlayKey: string }) {
  const { t } = useT();
  const draw = snap.draw;
  const [shown, setShown] = useState<{ id: string; fading: boolean } | null>(null);
  useEffect(() => {
    if (!draw || Date.now() - Date.parse(draw.created_at) > 30_000) return;
    const seen = `overlay.played.${overlayKey}`;
    try {
      if (localStorage.getItem(seen) === draw.id) return;
      localStorage.setItem(seen, draw.id);
    } catch {}
    const t0 = setTimeout(() => setShown({ id: draw.id, fading: false }), 0);
    const t1 = setTimeout(() => setShown({ id: draw.id, fading: true }), SHOWN - 700);
    const t2 = setTimeout(() => setShown(null), SHOWN);
    return () => [t0, t1, t2].forEach(clearTimeout);
  }, [draw, overlayKey]);
  if (!draw || shown?.id !== draw.id) return null;
  const lists = draw.result.teams ?? [draw.result.picked ?? []];
  const order = revealOrder(lists);
  return (
    <Panel title={t("overlay.draw.title")} className={cn("transition-opacity duration-700", shown.fading && "opacity-0")}>
      <div className={cn("grid gap-x-10 gap-y-1.5", lists.length === 2 && "grid-cols-2")}>
        {lists.map((l, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1.5">
            {order.filter((o) => o.team === i).map((o) => (
              <span key={o.entry.id} className="flex min-w-0 items-center gap-2">
                <Typed
                  text={o.entry.kick_username}
                  speed={REVEAL.speed}
                  reveal={REVEAL.sharpen}
                  startDelay={o.at}
                  className={cn("truncate text-overlay-name", lists.length === 2 ? tone((i + 1) as 1 | 2) : "text-(--o-gold)")}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Queue({ snap }: { snap: OverlaySnapshot }) {
  const { t } = useT();
  const q = snap.queue;
  if (!q || q.total === 0) return null;
  const more = q.total - q.rows.length;
  return (
    <Panel title={t("overlay.queue.title")}>
      <ol className="flex flex-col gap-1.5">
        {q.rows.map((p, i) => (
          <li key={p.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline">
            <span className="text-[1.5rem] text-(--o-muted) tabular-nums">{i + 1}</span>
            <Name name={p.kick_username} />
          </li>
        ))}
      </ol>
      {more > 0 && <p className="text-[1.5rem] text-(--o-muted)">{t("overlay.queue.more", { n: more })}</p>}
    </Panel>
  );
}

function Last({ snap }: { snap: OverlaySnapshot }) {
  const { t } = useT();
  const g = snap.last;
  if (!g) return null;
  return (
    <Panel title={t("overlay.last")}>
      <p className={cn("font-serif text-[2.25rem] leading-tight", tone(g.winner))}>{t("games.result", { n: g.n, team: t(`team.${g.winner}`) })}</p>
      <p className="text-overlay-name">{g.teams[g.winner - 1].join(", ")}</p>
    </Panel>
  );
}

// A leaderboard: the first place in gold, the rest muted; hidden when empty rather than say so
// on stream. The respect board only ever holds the top (0031).
function Board({ title, rows }: { title: "overlay.wins.stream" | "overlay.wins.all" | "overlay.respect"; rows: { name: string; value: string; extra: string | null }[] | undefined }) {
  const { t } = useT();
  if (!rows?.length) return null;
  return (
    <Panel title={t(title)}>
      <ol className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={r.name} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-5">
            <span className={cn("text-[1.5rem] tabular-nums", i === 0 ? "text-(--o-gold)" : "text-(--o-muted)")}>{i + 1}</span>
            <Name name={r.name} />
            <span className="text-overlay-name tabular-nums">{r.value}</span>
            <span className="text-[1.5rem] text-(--o-muted) tabular-nums">{r.extra}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
