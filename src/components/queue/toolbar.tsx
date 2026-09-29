"use client";
import { Dices, DoorClosed, DoorOpen, RefreshCw, Shuffle, Swords, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/components/i18n";
import { useAct, useCanWrite, useQueue } from "@/components/queue/store";
import { type PickSource, useDrawActions, usePick } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";
import { cn } from "@/lib/utils";
import { GOLD } from "@/components/numerals";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PICKS_COOKIE, TOOLBAR } from "@/components/queue/geometry";

export function Keys({ children }: { children: string }) {
  return (
    <DropdownMenuShortcut className="tracking-normal">
      <Kbd className="border border-row-edge bg-transparent">{children}</Kbd>
    </DropdownMenuShortcut>
  );
}

// The toolbar on every tab (August's action row): Add · Pick ×1 ×2 ×3 ×5 from waiting, the teams or
// the whole queue · Shuffle ▾ · Clear queue · Joining, at the right end. Under 768px the labels go
// and the icons stay.
export function Toolbar() {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const players = useQueue((v) => v.players);
  const standingTeams = useQueue((v) => v.draw?.kind === "teams");
  const { draw, reroll, shuffle, pick, clearTeams, clearQueue } = useDrawActions();
  const { source, setSource, sources, pool, sizes } = usePick();
  const playing = players.filter((p) => p.status === "playing").length;
  // A disabled button says why (D25).
  const offline = !canWrite ? t("why.offline") : null;
  // For the next load's skeleton, which draws as many ×n (geometry.ts).
  useEffect(() => {
    document.cookie = `${PICKS_COOKIE}=${sizes.length}; path=/; max-age=31536000; samesite=lax`;
  }, [sizes.length]);

  return (
    <div role="toolbar" aria-label={t("palette.actions")} className={TOOLBAR}>
      <Tip label={offline}>
        <Button variant="outline" size="lg" className="max-md:size-11" disabled={!canWrite} onClick={() => ui.setAdding(true)}>
          <UserPlus aria-hidden />
          <span className="max-md:sr-only">{t("action.add")}</span>
        </Button>
      </Tip>
      <Separator orientation="vertical" className="my-auto h-6! max-md:hidden" />

      <div role="group" aria-label={t("action.pick")} className="flex items-center rounded-lg border border-input">
        <span className="flex items-center gap-1.5 pr-1 pl-3 text-control text-muted-foreground select-none max-md:pl-2.5">
          <Dices className="size-4" aria-hidden />
          <span className="max-md:sr-only">{t("pick.label")}</span>
        </span>
        {sizes.map((n) => (
          <Tip key={n} label={offline ?? (pool === 0 ? t("why.pick_none") : null)}>
            <Button
              variant="ghost"
              size="lg"
              className="rounded-none px-2.5 tabular-nums max-md:h-11"
              disabled={!canWrite || pool === 0}
              aria-label={t("action.pick.n", { n })}
              onClick={() => void pick(n, source)}
            >
              ×{n}
            </Button>
          </Tip>
        ))}
        <Select value={source} onValueChange={(v) => setSource(v as PickSource)}>
          <SelectTrigger aria-label={t("pick.source")} className="h-9! rounded-l-none border-0 border-l border-input max-md:h-11!">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`pick.source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DropdownMenu>
        <Tip label={offline}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" className="max-md:size-11" disabled={!canWrite}>
              <Shuffle aria-hidden />
              <span className="max-md:sr-only">{t("action.shuffle")}</span>
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="min-w-60 p-1.5">
          <DropdownMenuItem onSelect={() => void draw()}>
            <Swords aria-hidden />
            {t("action.draw")}
            <Keys>D</Keys>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!standingTeams} onSelect={() => void reroll()}>
            <RefreshCw aria-hidden />
            {t("action.reroll")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={playing < 2} onSelect={() => void shuffle()}>
            <Shuffle aria-hidden />
            {t("action.shuffle_teams")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={playing === 0} onSelect={() => void clearTeams()}>
            <UsersRound aria-hidden />
            {t("action.clear_teams")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="my-auto h-6! max-md:hidden" />

      <Tip label={offline ?? (players.length === 0 ? t("why.queue_empty") : null)}>
        <Button
          variant="destructive"
          size="lg"
          className="max-md:size-11"
          disabled={!canWrite || players.length === 0}
          onClick={() => void clearQueue()}
        >
          <Trash2 aria-hidden />
          <span className="max-md:sr-only">{t("action.clear_queue")}</span>
        </Button>
      </Tip>
      <JoinButton />
    </div>
  );
}

// Joining open or closed (D23): one press mid-stream, for moderators too (set_join_open). With a
// queue limit it counts who is not playing against it. No toast: pressing again is the undo.
function JoinButton() {
  const { t } = useT();
  const act = useAct();
  const canWrite = useCanWrite();
  const open = useQueue((v) => v.settings.join_open);
  const max = useQueue((v) => v.settings.queue_max);
  const cmd = useQueue((v) => v.settings.join_command);
  const queued = useQueue((v) => v.players.filter((p) => p.status !== "playing").length);
  const Icon = open ? DoorOpen : DoorClosed;
  return (
    <Tip label={!canWrite ? t("why.offline") : t(open ? "join.close_tip" : "join.open_tip", { cmd })}>
      <Button
        variant="outline"
        size="lg"
        className="ml-auto max-md:h-11 max-md:px-3"
        aria-pressed={!open}
        disabled={!canWrite}
        onClick={() => void act("set_join_open", { p_open: !open })}
      >
        <Icon aria-hidden className={cn(!open && "text-warning")} />
        <span className={cn("max-md:sr-only", !open && "text-warning")}>{t(open ? "join.open" : "join.closed")}</span>
        {max > 0 && (
          <span className={cn(GOLD, queued >= max && "text-destructive")}>
            {queued}/{max}
          </span>
        )}
      </Button>
    </Tip>
  );
}
