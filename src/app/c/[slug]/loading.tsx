import { cookies } from "next/headers";
import { TAB_COOKIE, TABS, type Tab } from "@/components/queue/tabs";
import { Skeleton } from "@/components/ui/skeleton";

// While the dashboard loader runs (get_state, and a Kick subscription repair when due): the
// chrome, then the tab being opened in its own geometry (DESIGN.md § States → Loading; owner,
// 2026-09-27: each page and tab its own skeleton). The tab is the one the page will render, read
// from the same cookie. The Queue tab is measured against the page at 1280×720, so each row lands
// where its skeleton stood.
export default async function DashboardLoading() {
  const q = (await cookies()).get(TAB_COOKIE)?.value;
  const tab: Tab = TABS.find((t) => t === q) ?? "queue";
  const Body = BODIES[tab];
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
        <Body />
      </div>
    </div>
  );
}

// A row as the queue and the rosters draw it: 62px, edged, number, avatar, name.
function Row() {
  return (
    <div className="flex h-[3.875rem] items-center gap-3 rounded-xl border border-l-[3px] border-row-edge bg-row px-4">
      <Skeleton className="size-5" />
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="ml-auto h-4 w-24 max-md:hidden" />
    </div>
  );
}

// Title, then its filter pills (History and Management) with the tab's buttons on the right.
function Head({ pills = true, actions = 0 }: { pills?: boolean; actions?: number }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-10 w-36" />
          ))}
        </div>
      </div>
      {pills && <Skeleton className="h-10 w-96 max-w-full" />}
    </>
  );
}

function QueueBody() {
  return (
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
            <Row key={i} />
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
  );
}

// The match headline, two team cards of five slots, the actions bar.
function TeamsBody() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-6 w-8" />
        <Skeleton className="ml-auto h-10 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {[0, 1].map((c) => (
          <div key={c} className="flex flex-col overflow-hidden rounded-xl bg-card">
            <div className="h-[5px] bg-muted" />
            <div className="flex flex-col gap-3 p-4">
              <div className="flex h-9 items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-36" />
              </div>
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <Row key={i} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-28 max-md:hidden" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Sanctions: title with New and Clear, the pills, a list of rows.
function ModerationBody() {
  return (
    <div className="flex flex-col gap-4">
      <Head actions={2} />
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex h-16 items-center gap-3 rounded-xl bg-card px-4">
            <Skeleton className="size-5" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48 max-md:hidden" />
            <Skeleton className="ml-auto h-8 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

// A card per day: its heading, then time · icon · sentence lines.
function HistoryBody() {
  return (
    <div className="flex flex-col gap-4">
      <Head />
      {[6, 3].map((n, d) => (
        <div key={d} className="rounded-xl bg-card py-2">
          <div className="h-8 px-4 pt-2">
            <Skeleton className="h-3 w-20" />
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="grid h-9 grid-cols-[4.25rem_1rem_minmax(0,1fr)] items-center gap-x-3 px-4">
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="size-4" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Sections: title and hint on the left, the fields card on the right.
function SettingsBody() {
  return (
    <div className="flex flex-col">
      {[3, 2, 2].map((n, s) => (
        <div
          key={s}
          className="grid grid-cols-[16rem_minmax(0,1fr)] gap-6 border-t border-border py-8 first:border-t-0 first:pt-0 max-md:grid-cols-1 max-md:gap-4"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-48" />
          </div>
          <div className="flex flex-col gap-5 rounded-xl bg-card p-6 max-md:p-4">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-full max-w-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const BODIES: Record<Tab, () => React.ReactNode> = {
  queue: QueueBody,
  teams: TeamsBody,
  moderation: ModerationBody,
  history: HistoryBody,
  settings: SettingsBody,
};
