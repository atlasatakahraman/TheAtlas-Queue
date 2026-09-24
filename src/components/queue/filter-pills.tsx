"use client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { SLIDE, useSlide } from "@/components/use-slide";
import { cn } from "@/lib/utils";

// A pill group on a muted track (the queue filter, Moderation's subtabs); scrolls sideways on
// phones. The active pill's ground slides to the pill pressed (useSlide). The box is lighter
// than its track in both themes: card on Kâğıt's muted track, hover on Mürekkep's card track.
export function FilterPills<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  const { track, box } = useSlide(value);

  return (
    <ScrollArea className="rounded-lg bg-muted max-md:w-full dark:bg-card">
      <div ref={track} role="group" aria-label={label} className="relative flex w-max gap-1 p-1 select-none">
        <span
          ref={box}
          aria-hidden
          className={cn(SLIDE, "inset-y-1 rounded-lg bg-card shadow-xs dark:bg-accent")}
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
