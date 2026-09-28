import { Skeleton } from "@/components/ui/skeleton";

// While /welcome checks the session (DESIGN.md § Designed ahead → skeletons): the heading and
// its hint, then the three step cards with their numbered heads.
export default function WelcomeLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-8 py-12 max-md:px-4 max-md:py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[2.375rem] w-64 max-md:h-8" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24 shrink-0" />
      </div>
      {[1, 3, 1].map((lines, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-xl bg-card p-6 max-md:p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-6 w-44" />
          </div>
          {Array.from({ length: lines }, (_, j) => (
            <Skeleton key={j} className="h-4 w-full max-w-md" />
          ))}
        </div>
      ))}
    </div>
  );
}
