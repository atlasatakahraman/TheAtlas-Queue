"use client";
import { Ban, Check, Ellipsis, Hourglass, Plus, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { Tag } from "@/components/queue/player-row";
import { NewSanctionDialog } from "@/components/queue/sanction-dialog";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { useDrawActions } from "@/components/queue/teams-tab";
import { enter, useUi } from "@/components/queue/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/components/use-now";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Sanction } from "@/types/queue";

const KIND_ICON = { warn: TriangleAlert, punish: Hourglass, ban: Ban };

function isActive(m: Sanction, now: number) {
  return !m.revoked_at && (!m.expires_at || Date.parse(m.expires_at) > now) && (m.games_left === null || m.games_left > 0);
}

export function ModerationTab() {
  const { t } = useT();
  const ui = useUi();
  const moderation = useQueue((v) => v.moderation);
  const role = useQueue((v) => v.role);
  const canWrite = useCanWrite();
  const { clearModeration } = useDrawActions();
  const [creating, setCreating] = useState(false);
  const e3 = enter(ui.entering, 3);
  return (
    <div className="flex flex-col gap-4">
      <div style={e3.style} className={cn("flex flex-wrap items-end justify-between gap-4", e3.className)}>
        <h2 className="font-serif text-title">{t("tab.moderation")}</h2>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          <Button variant="outline" size="lg" className="max-md:h-11" disabled={!canWrite} onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t("mod.new")}
          </Button>
          {role === "owner" && (
            <Button
              variant="ghost"
              size="lg"
              className="text-destructive hover:text-destructive max-md:h-11"
              disabled={!canWrite || moderation.length === 0}
              onClick={() => void clearModeration()}
            >
              <Trash2 aria-hidden />
              {t("mod.clear")}
            </Button>
          )}
        </div>
      </div>
      <Sanctions list={moderation} />
      <NewSanctionDialog open={creating} onOpenChange={setCreating} />
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
          <Tag tone={active ? tone : "muted"} icon={KIND_ICON[m.kind]}>{t(`mod.kind.${m.kind}`)}</Tag>
          {!active && <Tag tone="muted" icon={m.revoked_at ? Undo2 : Check}>{t(m.revoked_at ? "mod.lifted" : "mod.served")}</Tag>}
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
