import { BAR, BAR_CONTROL, BAR_IN } from "@/components/queue/geometry";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Pieces the loading skeletons share (server components: no "use client").

// Words the page will show, drawn as their own skeleton: the same type, so the same box.
export function Shade({ className, wrap = false, children }: { className?: string; wrap?: boolean; children: React.ReactNode }) {
  return (
    <span aria-hidden className={cn("block w-fit max-w-full animate-pulse rounded-md bg-muted text-transparent select-none", !wrap && "truncate", className)}>
      {children}
    </span>
  );
}

// The top bar (header.tsx): the tile, the wordmark and the channel; right, the chat pill, the
// tools (folded into ⋯ under 1024px) and the account.
export function TopBarSkeleton() {
  return (
    <div className={BAR}>
      <div className={cn(BAR_IN, "flex items-center justify-between gap-3")}>
        <span className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <Shade className="font-serif text-title max-xl:text-body max-sm:hidden">TheAtlas Queue</Shade>
          <Skeleton className="h-[1lh] w-32 font-serif text-title max-xl:text-body" />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Skeleton className={cn(BAR_CONTROL, "w-24 rounded-full lg:w-36")} />
          <span className="flex gap-1 max-lg:hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="size-9" />
            ))}
          </span>
          <Skeleton className="size-11 md:size-9 lg:hidden" />
          <Skeleton className={cn(BAR_CONTROL, "w-11 md:w-9 xl:w-32")} />
        </span>
      </div>
    </div>
  );
}
