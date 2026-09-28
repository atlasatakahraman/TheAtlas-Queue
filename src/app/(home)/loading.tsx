import { Skeleton } from "@/components/ui/skeleton";

// While / works out who is signed in (DESIGN.md § Designed ahead → skeletons): the home page's
// own shape. In the (home) group, so it never shows on the way into the dashboard or /welcome.
export default function HomeLoading() {
  return (
    <div aria-busy className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-8 max-md:px-4">
      <div className="flex flex-1 flex-col justify-center gap-8 py-16">
        <Skeleton className="h-[2.375rem] w-72 max-md:h-8 max-md:w-56" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 w-48" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      <div className="flex h-[4.25rem] items-center justify-between gap-4 border-t border-border">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}
