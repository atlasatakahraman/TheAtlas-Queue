"use client";
import { Ban, Check, Ellipsis, Hourglass, Pencil, Plus, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n";
import { FilterPills } from "@/components/queue/filter-pills";
import { RespectBadge, Tag } from "@/components/queue/player-row";
import { NewSanctionDialog } from "@/components/queue/sanction-dialog";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { useDrawActions } from "@/components/queue/teams-tab";
import { enter, useUi } from "@/components/queue/ui";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStored } from "@/components/use-client-state";
import { useNow } from "@/components/use-now";
import { ago, span } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Sanction } from "@/types/queue";
import { MOD_COLS, MOD_ROW } from "@/components/queue/geometry";

const KINDS = ["warn", "punish", "ban"] as const;
type Kind = (typeof KINDS)[number];

function isActive(m: Sanction, now: number) {
  return !m.revoked_at && (!m.expires_at || Date.parse(m.expires_at) > now) && (m.games_left === null || m.games_left > 0);
}

// The tables' grids (DESIGN.md § Management tab), on the queue table's rules; under 768px only
// the player, the length and the menu stay.
const COLS: Record<Kind, string> = MOD_COLS;

export function ModerationTab() {
  const { t } = useT();
  const ui = useUi();
  const moderation = useQueue((v) => v.moderation);
  const role = useQueue((v) => v.role);
  const canWrite = useCanWrite();
  const { clearModeration } = useDrawActions();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useStored<Kind>("mod.subtab", "warn", KINDS);
  const counts = useMemo(() => {
    const c = { warn: 0, punish: 0, ban: 0 };
    for (const m of moderation) c[m.kind]++;
    return c;
  }, [moderation]);
  const e3 = enter(ui.entering, 3);
  return (
    <div className="flex flex-col gap-4">
      <div style={e3.style} className={cn("flex flex-col gap-4", e3.className)}>
        <h2 className="font-serif text-title">{t("tab.moderation")}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <FilterPills
            label={t("mod.sub.label")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: t(`mod.sub.${k}`), count: counts[k] }))}
          />
          <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0 max-md:w-full">
            <Button size="lg" className="max-md:h-11" disabled={!canWrite} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("mod.new")}
            </Button>
            {role === "owner" && (
              <Button
                variant="destructive"
                size="lg"
                className="max-md:h-11"
                disabled={!canWrite || moderation.length === 0}
                onClick={() => void clearModeration()}
              >
                <Trash2 aria-hidden />
                {t("mod.clear")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <SanctionTable kind={kind} list={moderation.filter((m) => m.kind === kind)} />
      <NewSanctionDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function SanctionTable({ kind, list }: { kind: Kind; list: Sanction[] }) {
  const { t } = useT();
  const now = useNow();
  if (list.length === 0) {
    return (
      <div className="flex flex-col gap-1 py-10">
        <p className="font-serif text-title">{t(`mod.empty.${kind}`)}</p>
        <p className="text-muted-foreground">{t("mod.empty.hint")}</p>
      </div>
    );
  }
  const th = "text-caption text-muted-foreground uppercase select-none";
  return (
    <div data-rows className="flex flex-col gap-1.5">
      <div aria-hidden className={cn("grid items-center gap-x-3 border border-transparent px-4 max-md:hidden", COLS[kind])}>
        <span className={th}>{t("col.player")}</span>
        {kind === "punish" && <span className={th}>{t("col.length")}</span>}
        <span className={th}>{t("col.reason")}</span>
        <span className={th}>{t("col.respect")}</span>
        <span className={th}>{t(kind === "warn" ? "col.given" : kind === "punish" ? "col.ends" : "col.since")}</span>
        <span />
      </div>
      {list.map((m) => (
        <SanctionRow key={m.id} m={m} now={now} />
      ))}
    </div>
  );
}

function SanctionRow({ m, now }: { m: Sanction; now: number }) {
  const { t, lang } = useT();
  const active = now === 0 || isActive(m, now);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const length =
    m.games_left !== null
      ? t("mod.length.games", { n: m.games_left })
      : m.expires_at && now
        ? t("mod.time_left", { t: span(Date.parse(m.expires_at) - now, t) })
        : "";
  // The last column: given (when and by whom) for warnings, the end for punishments, the start
  // for bans. Two lines, never joined by a glyph.
  const last =
    m.kind === "punish" ? (
      <span>{m.expires_at ? when(m.expires_at) : active ? t("mod.after_games") : ""}</span>
    ) : (
      <>
        <span>{m.kind === "ban" ? when(m.created_at) : now ? ago(m.created_at, now, t) : ""}</span>
        <span className="truncate">
          {m.kind === "ban" && !m.expires_at ? t("sanction.permanent") : t("mod.by", { name: m.created_by ?? t("common.chat") })}
        </span>
      </>
    );
  return (
    <div
      className={cn(
        MOD_ROW,
        COLS[m.kind],
        !active && "border-dashed bg-transparent text-muted-foreground",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="truncate text-name">{m.kick_username}</span>
        {m.kind === "warn" && active && (
          <Tag tone="warning" icon={TriangleAlert}>{t(m.level === 2 ? "mod.warn.second" : "mod.warn.first")}</Tag>
        )}
        {!active && <Tag tone="muted" icon={m.revoked_at ? Undo2 : Check}>{t(m.revoked_at ? "mod.lifted" : "mod.served")}</Tag>}
      </div>
      {m.kind === "punish" && <span className="text-meta tabular-nums">{active ? length : ""}</span>}
      <span className="min-w-0 text-meta break-words max-md:hidden">{m.reason}</span>
      <span className="max-md:hidden">
        <RespectBadge name={m.kick_username} />
      </span>
      <span className="flex min-w-0 flex-col text-meta text-muted-foreground tabular-nums max-md:hidden">{last}</span>
      <SanctionMenu m={m} active={active} />
    </div>
  );
}

// A sanction's ⋯ (D25, D22): warn again and ban as August's Uyarı Ekle and Yasakla, for a player
// who may have left the queue; convert, edit length and lift while it runs; delete.
function SanctionMenu({ m, active }: { m: Sanction; active: boolean }) {
  const { t } = useT();
  const act = useAct();
  const ui = useUi();
  const canWrite = useCanWrite();
  const name = m.kick_username;
  const vars = { name };
  const warnTone = "text-warning focus:text-current [&_svg]:text-current!";
  return (
    <DropdownMenu>
      <Tip label={t("menu.open", { name })}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="max-md:size-11" aria-label={t("menu.open", { name })}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-56 p-1.5">
        {m.kind === "warn" && (
          <DropdownMenuItem disabled={!canWrite} className={warnTone} onSelect={() => ui.setSanction({ name, kind: "warn" })}>
            <TriangleAlert aria-hidden />
            {t("mod.warn_again")}
          </DropdownMenuItem>
        )}
        {m.kind === "warn" && active && (
          <DropdownMenuItem disabled={!canWrite} className={warnTone} onSelect={() => ui.setSanction({ name, kind: "punish", edit: m })}>
            <Hourglass aria-hidden />
            {t("mod.convert")}
          </DropdownMenuItem>
        )}
        {m.kind !== "warn" && active && (
          <DropdownMenuItem disabled={!canWrite} onSelect={() => ui.setSanction({ name, kind: m.kind, edit: m })}>
            <Pencil aria-hidden />
            {t("mod.edit_length")}
          </DropdownMenuItem>
        )}
        {m.kind !== "ban" && (
          <DropdownMenuItem variant="destructive" disabled={!canWrite} onSelect={() => ui.setSanction({ name, kind: "ban" })}>
            <Ban aria-hidden />
            {t("menu.ban")}
          </DropdownMenuItem>
        )}
        {active && (
          <DropdownMenuItem disabled={!canWrite} onSelect={() => act("revoke_sanction", { p_id: m.id }, { done: "done.revoke", vars })}>
            <Undo2 aria-hidden />
            {t("mod.revoke")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!canWrite}
          onSelect={() => act("delete_sanction", { p_id: m.id }, { done: "done.delete_sanction", vars })}
        >
          <Trash2 aria-hidden />
          {t("mod.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
