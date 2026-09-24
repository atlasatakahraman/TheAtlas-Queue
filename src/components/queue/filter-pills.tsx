"use client";
import { useLayoutEffect, useRef } from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// A pill group on a muted track (the queue filter, Moderation's subtabs); scrolls sideways on
// phones. The active pill's ground is one box that slides to the pill pressed (August's
// sliding-tabs: 300ms, ease-out-expo), placed through its ref so a render never waits on it.
// Kâğıt's track and hover share a value, so the box steps up to the card there.
export function FilterPills<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const g = group.current;
    const b = box.current;
    if (!g || !b) return;
    const place = () => {
      const a = g.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!a) return;
      b.style.transform = `translateX(${a.offsetLeft}px)`;
      b.style.width = `${a.offsetWidth}px`;
      // No slide on first paint: the box appears where it belongs, then moves from there on.
      requestAnimationFrame(() => (b.dataset.ready = ""));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(g);
    return () => ro.disconnect();
  }, [value, options]);

  return (
    <ScrollArea className="rounded-lg bg-muted max-md:w-full">
      <div ref={group} role="group" aria-label={label} className="relative flex w-max gap-1 p-1 select-none">
        <span
          ref={box}
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 w-0 rounded-lg bg-card shadow-xs dark:bg-accent data-ready:transition-[transform,width] data-ready:duration-300 data-ready:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none!"
        />
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-control transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11",
              value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="text-muted-foreground tabular-nums">{o.count}</span>}
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
