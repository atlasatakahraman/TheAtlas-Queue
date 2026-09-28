import { MAIN, ROW, SHADE, SLOT, TEAMS_GRID } from "@/components/queue/geometry";
import { SlimBar } from "@/components/status-page";
import { cn } from "@/lib/utils";

// The page being opened (D25): the bar, the title, the teams and a few queue rows, shaded.
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy>
      <SlimBar tools={<span className="h-9 w-24" />} />
      <main className={cn(MAIN, "max-md:pb-8")}>
        <div className="flex flex-col gap-1">
          <span className={cn(SHADE, "h-10 w-72 rounded-lg max-md:h-8")} />
          <span className={cn(SHADE, "h-6 w-56 rounded-md")} />
        </div>
        <div className={TEAMS_GRID}>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-xl bg-card p-4">
              <span className={cn(SHADE, "h-9 w-32 rounded-md")} />
              {[0, 1, 2].map((j) => (
                <span key={j} className={cn(SHADE, SLOT, "rounded-xl")} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((j) => (
            <span key={j} className={cn(SHADE, ROW, SLOT)} />
          ))}
        </div>
      </main>
    </div>
  );
}
