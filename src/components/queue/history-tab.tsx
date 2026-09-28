"use client";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Ban,
  BadgeCheck,
  Coffee,
  Dices,
  Eraser,
  Hand,
  Hourglass,
  KeyRound,
  ListX,
  Lock,
  LogOut,
  type LucideIcon,
  MessageSquarePlus,
  MessageSquareX,
  Pencil,
  Radio,
  RadioOff,
  Scale,
  Settings2,
  ShieldOff,
  Shuffle,
  Trash2,
  TriangleAlert,
  Undo2,
  UserMinus,
  UserPlus,
  UserX,
} from "lucide-react";
import { Fragment, useMemo } from "react";
import { useT } from "@/components/i18n";
import { FilterPills } from "@/components/queue/filter-pills";
import { Tag } from "@/components/queue/player-row";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { useDrawActions } from "@/components/queue/teams-tab";
import { Button } from "@/components/ui/button";
import { enter, useUi } from "@/components/queue/ui";
import { useStored } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { isLabelKey, type LabelKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Activity } from "@/types/queue";

const KINDS = ["all", "queue", "teams", "moderation", "chat"] as const;
type Kind = (typeof KINDS)[number];

// Each action's icon, colour and filter. Moves into a team take that team's colour at render.
const LOOK: Record<string, [LucideIcon, string, Exclude<Kind, "all">]> = {
  add_player: [UserPlus, "text-brand", "queue"],
  update_player: [Pencil, "text-muted-foreground", "queue"],
  move_player: [ArrowLeftRight, "text-muted-foreground", "queue"],
  move_players: [ArrowLeftRight, "text-muted-foreground", "teams"],
  settle: [Hourglass, "text-warning", "moderation"],
  remove_players: [UserMinus, "text-muted-foreground", "queue"],
  reorder_player: [ArrowUpDown, "text-muted-foreground", "queue"],
  clear_queue: [ListX, "text-destructive", "queue"],
  remove_protection: [ShieldOff, "text-muted-foreground", "queue"],
  set_fair_play: [Scale, "text-muted-foreground", "teams"],
  draw_teams: [Dices, "text-brand", "teams"],
  reroll: [Dices, "text-brand", "teams"],
  pick_from_waiting: [Hand, "text-brand", "teams"],
  pick_from_teams: [Hand, "text-brand", "teams"],
  pick_from_all: [Hand, "text-brand", "teams"],
  shuffle_teams: [Shuffle, "text-brand", "teams"],
  clear_teams: [Eraser, "text-destructive", "teams"],
  clear_moderation: [Trash2, "text-destructive", "moderation"],
  clear_history: [Trash2, "text-destructive", "moderation"],
  warn: [TriangleAlert, "text-warning", "moderation"],
  punish: [Hourglass, "text-warning", "moderation"],
  ban: [Ban, "text-destructive", "moderation"],
  revoke_sanction: [Undo2, "text-muted-foreground", "moderation"],
  delete_sanction: [Trash2, "text-muted-foreground", "moderation"],
  update_settings: [Settings2, "text-muted-foreground", "moderation"],
  add_member: [KeyRound, "text-success", "moderation"],
  set_member_blocked: [Lock, "text-muted-foreground", "moderation"],
  remove_member: [UserX, "text-muted-foreground", "moderation"],
  member_badge: [BadgeCheck, "text-success", "moderation"],
  chat_join: [MessageSquarePlus, "text-success", "chat"],
  chat_rejected: [MessageSquareX, "text-destructive", "chat"],
  chat_leave: [LogOut, "text-muted-foreground", "chat"],
  chat_away: [Coffee, "text-muted-foreground", "chat"],
  stream_live: [Radio, "text-success", "chat"],
  stream_offline: [RadioOff, "text-muted-foreground", "chat"],
};
const UNDO: [LucideIcon, string, undefined] = [Undo2, "text-muted-foreground", undefined];

// A label with its {slots} filled by nodes, so names can be set apart inside a translated sentence.
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

// Who did what (DESIGN.md § Roles), its own tab (owner, 2026-09-27): one card per day, a line per
// change with its time, an icon in the action's colour and the sentence; chat and the system read
// "chat". Filtered by what the change touched.
export function HistoryTab() {
  const { t, lang } = useT();
  const ui = useUi();
  const now = useNow();
  const activity = useQueue((v) => v.activity);
  const role = useQueue((v) => v.role);
  const canWrite = useCanWrite();
  const { clearHistory } = useDrawActions();
  const [kind, setKind] = useStored<Kind>("queue.history-kind", "all", KINDS);
  const e3 = enter(ui.entering, 3);
  const e4 = enter(ui.entering, 4);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: activity.length, queue: 0, teams: 0, moderation: 0, chat: 0 };
    for (const a of activity) {
      const k = category(a);
      if (k) c[k]++;
    }
    return c;
  }, [activity]);

  // Days are the viewer's own, so they wait for the clock (useNow is 0 on the server).
  const days = useMemo(() => {
    const rows = activity.filter((a) => kind === "all" || category(a) === kind).slice(0, 150);
    if (!now) return [{ day: "", rows }];
    const rel = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    const long = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" });
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const out: { day: string; rows: Activity[] }[] = [];
    for (const a of rows) {
      const at = new Date(a.created_at);
      const back = Math.round((midnight - new Date(at).setHours(0, 0, 0, 0)) / 864e5);
      const day = back < 2 ? rel.format(-back, "day") : long.format(at);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(a);
    }
    return out;
  }, [activity, kind, now, lang]);

  const clock = now ? new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex flex-col gap-4">
      <div style={e3.style} className={cn("flex flex-wrap items-end justify-between gap-4", e3.className)}>
        <h2 className="font-serif text-title">{t("tab.history")}</h2>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          <FilterPills
            label={t("mod.show")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({
              value: k,
              label: t(k === "all" ? "filter.all" : k === "chat" ? "history.chat" : `tab.${k}`),
              count: counts[k],
            }))}
          />
          {/* Owner only, as Clear sanctions (owner, 2026-09-28). */}
          {role === "owner" && (
            <Button
              variant="destructive"
              size="lg"
              className="max-md:h-11"
              disabled={!canWrite || activity.length === 0 || (activity.length === 1 && activity[0].action === "clear_history")}
              onClick={() => void clearHistory()}
            >
              <Trash2 aria-hidden />
              {t("history.clear")}
            </Button>
          )}
        </div>
      </div>
      <div style={e4.style} className={cn("flex flex-col gap-4", e4.className)}>
        {days[0].rows.length === 0 ? (
          <p className="py-10 text-muted-foreground">{t("mod.activity.empty")}</p>
        ) : (
          days.map(({ day, rows }, i) => (
            <section key={day || i} className="rounded-xl bg-card py-2">
              <h3 className="h-8 px-4 pt-2 text-caption text-muted-foreground uppercase select-none">{day}</h3>
              <ol>
                {rows.map((a) => (
                  <Line key={a.id} a={a} clock={clock} />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function category(a: Activity): Exclude<Kind, "all"> | undefined {
  if (a.action === "move_player" && a.payload.status === "playing") return "teams";
  return LOOK[a.action]?.[2];
}

function Line({ a, clock }: { a: Activity; clock: Intl.DateTimeFormat | null }) {
  const { t } = useT();
  const toTeam =
    (a.action === "move_player" && a.payload.status === "playing") || a.action === "move_players" ? (a.payload.team === 2 ? 2 : 1) : null;
  const [Icon, tone] = LOOK[a.action] ?? UNDO;
  const where = toTeam
    ? t(`team.${toTeam}`)
    : a.action === "move_player"
      ? t(a.payload.status === "away" ? "act.where.away" : "act.where.waiting")
      : "";
  const key = `act.${a.action}`;
  const text = isLabelKey(key) ? t(key as LabelKey, { n: String(a.payload.count ?? a.payload.n ?? "") }) : t("act.other", { action: a.action });
  const name = "font-medium text-foreground";
  const team = toTeam === 2 ? "text-team-2" : "text-team-1";
  return (
    <li
      className={cn(
        "grid grid-cols-[4.25rem_1rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2 text-body transition-colors hover:bg-accent/60",
        a.undone_at && "text-muted-foreground",
      )}
    >
      <time dateTime={a.created_at} className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">
        {clock?.format(new Date(a.created_at))}
      </time>
      <Icon aria-hidden className={cn("size-4 translate-y-0.5 self-start", toTeam ? team : tone, a.undone_at && "opacity-50")} />
      <span className={cn("min-w-0 break-words text-muted-foreground", a.undone_at && "line-through decoration-muted-foreground/60")}>
        <Rich
          text={text}
          parts={{
            actor: <span className={name}>{a.actor ?? t("common.chat")}</span>,
            target: <span className={cn(name, "break-all")}>{a.target}</span>,
            where: <span className={cn("font-medium", toTeam ? team : "text-foreground")}>{where}</span>,
          }}
        />
      </span>
      <span>{a.undone_at && <Tag tone="muted" icon={Undo2}>{t("mod.undone")}</Tag>}</span>
    </li>
  );
}
