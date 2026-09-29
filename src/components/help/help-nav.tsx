"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEARCH } from "@/components/queue/geometry";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type HelpHeading = { href: string; title: string; topic: string };

// Search across every topic's headings (DESIGN.md § Help): the titles only, each a link to its
// anchor; Enter opens the first, Esc clears.
export function HelpSearch({ index, label, none }: { index: HelpHeading[]; label: string; none: string }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const needle = q.trim().toLocaleLowerCase();
  const hits = needle ? index.filter((h) => h.title.toLocaleLowerCase().includes(needle)).slice(0, 8) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
            if (e.key !== "Enter" || e.nativeEvent.isComposing || !hits[0]) return;
            e.preventDefault();
            setQ("");
            router.push(hits[0].href);
          }}
          placeholder={label}
          aria-label={label}
          className={cn(SEARCH, "w-full")}
        />
      </div>
      {needle &&
        (hits.length === 0 ? (
          <p className="px-3 text-meta text-muted-foreground">{none}</p>
        ) : (
          <ul className="flex flex-col">
            {hits.map((h) => (
              <li key={h.href}>
                <Link
                  href={h.href}
                  onClick={() => setQ("")}
                  className="flex flex-col rounded-lg px-3 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="text-body">{h.title}</span>
                  <span className="text-meta text-muted-foreground">{h.topic}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

// Phones: the topic list as a Select above the article.
export function TopicSelect({ topics, current, label }: { topics: { value: string; title: string; href: string }[]; current: string; label: string }) {
  const router = useRouter();
  return (
    <Select value={current} onValueChange={(v) => router.push(topics.find((t) => t.value === v)?.href ?? "/wiki")}>
      <SelectTrigger aria-label={label} className="h-11! w-full">
        {/* Given its text, so the server's HTML shows the topic before hydration. */}
        <SelectValue>{topics.find((t) => t.value === current)?.title}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {topics.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
