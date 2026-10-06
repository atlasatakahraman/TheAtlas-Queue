"use client";
import { useLayoutEffect, useRef } from "react";

// Near miss → save (P8): a gold shield slams in at its parent's centre, cracks down the middle,
// and its halves fly to the parent's left and right edges, which flash where they hit. The parent
// must be `relative`. Measures once per mount; animates transform and opacity only (globals.css
// § Shield break).
export const BREAK = { crack: 380, split: 540, impact: 840, settle: 860, done: 1200 } as const;

const SHIELD = "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";
const SHARDS = [[-90, -40, -160], [-70, 34, 130], [-34, -58, -90], [40, -56, 100], [80, 30, 210], [96, -26, -140], [-12, 62, 60], [18, 64, -60]] as const;

export function ShieldBreak() {
  const root = useRef<HTMLDivElement>(null);
  const emblem = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    const e = emblem.current?.getBoundingClientRect();
    if (!r || !e || !emblem.current) return;
    emblem.current.style.setProperty("--sb-to-l", `${r.left - e.left}px`);
    emblem.current.style.setProperty("--sb-to-r", `${r.right - e.right}px`);
  }, []);
  return (
    <div ref={root} aria-hidden className="shield-break pointer-events-none absolute inset-0 z-10">
      <span className="sb-glint left-0" />
      <span className="sb-glint right-0" />
      <div ref={emblem} className="absolute top-1/2 left-1/2 h-19 w-17 -translate-x-1/2 -translate-y-1/2 text-brand">
        <span className="sb-flash" />
        {(["l", "r"] as const).map((h) => (
          <svg key={h} className={`sb-half sb-${h}`} viewBox="0 0 24 26">
            <path d={SHIELD} fill="currentColor" />
            <path d="m8.6 12.2 2.4 2.4 4.4-4.6" fill="none" stroke="var(--background)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ))}
        <svg className="sb-crack" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points="52,-6 45,28 57,50 46,72 51,96" />
        </svg>
        {SHARDS.map(([dx, dy, r], i) => (
          <span key={i} className="sb-shard" style={{ "--dx": `${dx}px`, "--dy": `${dy}px`, "--r": `${r}deg` } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}
