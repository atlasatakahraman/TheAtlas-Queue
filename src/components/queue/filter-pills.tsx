"use client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// A pill group on a muted track (the queue filter, Moderation's subtabs); scrolls sideways on
// phones. Kâğıt's track and hover share a value, so the active pill steps up to the card there.
export function FilterPills<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <ScrollArea className="rounded-lg bg-muted max-md:w-full">
      <div role="group" aria-label={label} className="flex w-max gap-1 p-1 select-none">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-control outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11",
              value === o.value ? "bg-card text-foreground shadow-xs dark:bg-accent" : "text-muted-foreground hover:text-foreground",
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
