import { Skeleton } from "@/components/ui/skeleton";

// While the dashboard loader runs (get_state, and a Kick subscription repair when due): the Queue
// tab's own geometry in skeletons (DESIGN.md § States → Loading), measured against the page at
// 1280×720, so each row lands where its skeleton stood (owner, 2026-09-27: rows jumped ~100px).
// The other tabs get their own in Stage 9 (D25).
export default function DashboardLoading() {
  return (
    <div aria-busy className="flex flex-1 flex-col">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-[3.75rem] w-full max-w-[1440px] items-center justify-between px-8 max-md:px-4">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-8 pt-8 max-md:px-4 max-md:pt-6">
        <Skeleton className="ml-auto h-[2.375rem] w-[37rem] max-w-full" />
        <Skeleton className="h-15 w-full rounded-xl max-md:hidden" />
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6 max-lg:grid-cols-1">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-24" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-10 w-80 max-w-full" />
              <Skeleton className="ml-auto h-9 w-64 max-md:ml-0 max-md:h-11 max-md:w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="h-[1.125rem] max-md:hidden" />
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex h-[3.875rem] items-center gap-3 rounded-xl border border-l-[3px] border-row-edge bg-row px-4">
                  <Skeleton className="size-5" />
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-24 max-md:hidden" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 max-lg:hidden">
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex h-21 flex-col justify-center gap-2 rounded-xl bg-card p-4">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-6 w-8" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
