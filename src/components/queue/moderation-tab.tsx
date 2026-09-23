"use client";
import { Ellipsis } from "lucide-react";
import { Fragment, useMemo } from "react";
import { useT } from "@/components/i18n";
import { FilterPills } from "@/components/queue/filter-pills";
import { Tag } from "@/components/queue/player-row";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { enter, useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStored } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { isLabelKey, type LabelKey } from "@/lib/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Activity, Sanction } from "@/types/queue";

const SUBTABS = ["sanctions", "activity"] as const;
type Subtab = (typeof SUBTABS)[number];

// A label with its {slots} filled by nodes, so names can be set bold inside a translated sentence.
function Rich({ text, parts }: { text: string; parts: Record<string, React.ReactNode> }) {
  return (
    <>
      {text.split(/(\{\w+\})/).map((chunk, i) => {
        const k = chunk.match(/^\{(\w+)\}$/)?.[1];
        return <Fragment key={i}>{k && k in parts ? parts[k] : chunk}</Fragment>;
      })}
    </>
  );
}

function isActive(m: Sanction, now: number) {
  return !m.revoked_at && (!m.expires_at || Date.parse(m.expires_at) > now) && (m.games_left === null || m.games_left > 0);
}

export function ModerationTab() {
  const { t } = useT();
  const ui = useUi();
  const [sub, setSub] = useStored<Subtab>("queue.mod-subtab", "sanctions", SUBTABS);
  const moderation = useQueue((v) => v.moderation);
  const activity = useQueue((v) => v.activity);
  const e3 = enter(ui.entering, 3);
  return (
    <div className="flex flex-col gap-4">
      <div style={e3.style} className={cn("flex flex-wrap items-end justify-between gap-4", e3.className)}>
        <h2 className="font-serif text-title">{t("tab.moderation")}</h2>
        <FilterPills
          label={t("mod.show")}
          value={sub}
          onChange={setSub}
          options={[
            { value: "sanctions", label: t("mod.sanctions"), count: moderation.length },
            { value: "activity", label: t("mod.activity") },
          ]}
        />
      </div>
      {sub === "sanctions" ? <Sanctions list={moderation} /> : <ActivityList list={activity} />}
    </div>
  );
}

function Sanctions({ list }: { list: Sanction[] }) {
  const { t } = useT();
  const now = useNow();
  const respect = useQueue((v) => v.respect);
  if (list.length === 0) {
    return (
      <div className="flex flex-col gap-1 py-10">
        <p className="font-serif text-title">{t("mod.empty.title")}</p>
        <p className="text-muted-foreground">{t("mod.empty.hint")}</p>
      </div>
    );
  }
  return (
    <div data-rows className="flex flex-col gap-1.5">
      {list.map((m) => (
        <SanctionRow key={m.id} m={m} now={now} respect={respect[m.kick_username.toLowerCase()]} />
      ))}
    </div>
  );
}

function SanctionRow({ m, now, respect }: { m: Sanction; now: number; respect?: number }) {
  const { t, lang } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const active = now === 0 || isActive(m, now);
  const until = m.expires_at && new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(m.expires_at));
  const detail =
    m.kind === "warn"
      ? t(m.level === 2 ? "mod.warn.second" : "mod.warn.first")
      : m.games_left !== null
        ? t("mod.games_left", { n: m.games_left })
        : until
          ? t("mod.until", { time: until })
          : t("sanction.permanent");
  const tone = m.kind === "ban" ? "destructive" : "warning";
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-xl border border-row-edge bg-row px-4 py-3",
        !active && "border-dashed bg-transparent",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-name">{m.kick_username}</span>
          <Tag tone={active ? tone : "muted"}>{t(`mod.kind.${m.kind}`)}</Tag>
          {!active && <Tag tone="muted">{t(m.revoked_at ? "mod.lifted" : "mod.served")}</Tag>}
        </div>
        <p className="text-meta text-muted-foreground">
          {detail}
          {" · "}
          {t("mod.by", { name: m.created_by ?? t("common.chat") })}
          {now ? ` · ${ago(m.created_at, now, t)}` : ""}
        </p>
        {m.reason && <p className="text-meta break-words text-foreground/90">{m.reason}</p>}
      </div>
      <span className="text-meta text-muted-foreground tabular-nums max-sm:hidden">
        {respect !== undefined && t("mod.respect", { n: respect })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("menu.open", { name: m.kick_username })}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48 p-1.5">
          {active && (
            <DropdownMenuItem
              disabled={!canWrite}
              onSelect={() => act("revoke_sanction", { p_id: m.id }, { done: "done.revoke", vars: { name: m.kick_username } })}
            >
              {t("mod.revoke")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={!canWrite}
            onSelect={() => act("delete_sanction", { p_id: m.id }, { done: "done.delete_sanction", vars: { name: m.kick_username } })}
          >
            {t("mod.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Who did what (DESIGN.md § Roles): every change is attributed; chat and the system read "chat".
function ActivityList({ list }: { list: Activity[] }) {
  const { t } = useT();
  const now = useNow();
  const rows = useMemo(() => list.slice(0, 100), [list]);
  if (rows.length === 0) return <p className="py-10 text-muted-foreground">{t("mod.activity.empty")}</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((a) => {
        const key = `act.${a.action}`;
        const where =
          a.action === "move_player"
            ? a.payload.status === "playing"
              ? t(`team.${a.payload.team === 2 ? 2 : 1}`)
              : t(a.payload.status === "away" ? "act.where.away" : "act.where.waiting")
            : "";
        const text = isLabelKey(key) ? t(key as LabelKey, { n: String(a.payload.count ?? a.payload.n ?? "") }) : t("act.other", { action: a.action });
        return (
          <li
            key={a.id}
            className={cn(
              "flex items-baseline justify-between gap-4 rounded-xl border border-row-edge bg-row px-4 py-3 text-body",
              a.undone_at && "text-muted-foreground",
            )}
          >
            <span className="min-w-0">
              <Rich
                text={text}
                parts={{
                  actor: <span className="font-semibold">{a.actor ?? t("common.chat")}</span>,
                  target: <span className="font-semibold">{a.target}</span>,
                  where: <span className="font-semibold">{where}</span>,
                }}
              />
              {a.undone_at && <span className="ml-2 inline-flex align-middle"><Tag tone="muted">{t("mod.undone")}</Tag></span>}
            </span>
            <span className="shrink-0 text-meta text-muted-foreground">{now ? ago(a.created_at, now, t) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
