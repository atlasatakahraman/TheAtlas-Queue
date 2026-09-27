"use client";
import { Dices, RefreshCw, Shuffle, Swords, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useT } from "@/components/i18n";
import { useCanWrite, useQueue } from "@/components/queue/store";
import { type PickSource, useDrawActions, usePick } from "@/components/queue/teams-tab";
import { useUi } from "@/components/queue/ui";
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

export function Keys({ children }: { children: string }) {
  return (
    <DropdownMenuShortcut className="tracking-normal">
      <Kbd className="border border-row-edge bg-transparent">{children}</Kbd>
    </DropdownMenuShortcut>
  );
}

// The toolbar on every tab (August's action row): Add · Pick ×1 ×2 ×3 from waiting, the teams or
// the whole queue · Shuffle ▾ · Clear queue. Under 768px the labels go and the icons stay.
export function Toolbar() {
  const { t } = useT();
  const ui = useUi();
  const canWrite = useCanWrite();
  const players = useQueue((v) => v.players);
  const standingTeams = useQueue((v) => v.draw?.kind === "teams");
  const { draw, reroll, shuffle, pick, clearTeams, clearQueue } = useDrawActions();
  const { source, setSource, sources, pool, sizes } = usePick();
  const playing = players.filter((p) => p.status === "playing").length;

  return (
    <div role="toolbar" aria-label={t("palette.actions")} className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="lg" className="max-md:size-11" disabled={!canWrite} onClick={() => ui.setAdding(true)}>
        <UserPlus aria-hidden />
        <span className="max-md:sr-only">{t("action.add")}</span>
      </Button>
      <Separator orientation="vertical" className="my-auto h-6! max-md:hidden" />

      <div role="group" aria-label={t("action.pick")} className="flex items-center rounded-lg border border-input">
        <span className="flex items-center gap-1.5 pr-1 pl-3 text-control text-muted-foreground select-none max-md:pl-2.5">
          <Dices className="size-4" aria-hidden />
          <span className="max-md:sr-only">{t("pick.label")}</span>
        </span>
        {sizes.map((n) => (
          <Button
            key={n}
            variant="ghost"
            size="lg"
            className="rounded-none px-2.5 tabular-nums max-md:h-11"
            disabled={!canWrite || pool === 0}
            aria-label={t("action.pick.n", { n })}
            onClick={() => void pick(n, source)}
          >
            ×{n}
          </Button>
        ))}
        <Select value={source} onValueChange={(v) => setSource(v as PickSource)}>
          <SelectTrigger aria-label={t("pick.source")} className="h-9! rounded-l-none border-0 border-l border-input max-md:h-11!">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`pick.source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg" className="max-md:size-11" disabled={!canWrite}>
            <Shuffle aria-hidden />
            <span className="max-md:sr-only">{t("action.shuffle")}</span>
          </Button>
        </DropdownMenuTrigger>
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

      <Button
        variant="ghost"
        size="lg"
        className="text-destructive hover:text-destructive max-md:size-11"
        disabled={!canWrite || players.length === 0}
        onClick={() => void clearQueue()}
      >
        <Trash2 aria-hidden />
        <span className="max-md:sr-only">{t("action.clear_queue")}</span>
      </Button>
    </div>
  );
}
