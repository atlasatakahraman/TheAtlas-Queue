import { Skeleton } from "@/components/ui/skeleton";

// While the dashboard loader runs (get_state, and a Kick subscription repair when due): the page's
// own shape in skeletons (DESIGN.md § States → Loading), so nothing jumps when it lands.
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-9 w-96 max-w-full" />
        </div>
        <Skeleton className="h-15 w-full rounded-xl max-md:hidden" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-15 items-center gap-3 rounded-xl border border-row-edge bg-row px-4">
              <Skeleton className="size-5" />
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-24 max-md:hidden" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
