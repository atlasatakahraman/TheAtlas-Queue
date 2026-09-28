import { Skeleton } from "@/components/ui/skeleton";

// A game's page while it loads (DESIGN.md § A game's page → States): the chrome, the back link and
// buttons, the headline and its line, and two team cards of 62px rows.
export default function GameLoading() {
  return (
    <div aria-busy className="flex flex-1 flex-col">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-[3.75rem] w-full max-w-[1440px] items-center justify-between px-8 max-md:px-4">
          <Skeleton className="h-6 w-72 max-w-[60%]" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-8 pt-8 max-md:px-4 max-md:pt-6">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-64 max-w-[50%]" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-96 max-w-full" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">
          {[0, 1].map((c) => (
            <div key={c} className="flex flex-col gap-3 rounded-xl bg-card p-4 pt-[calc(1rem+5px)]">
              <Skeleton className="h-9 w-32" />
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[3.875rem] w-full rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
