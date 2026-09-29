"use client";
import { Ban, CircleHelp, Radio, ShieldCheck, Trophy, TriangleAlert, Gavel } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rememberPlace, rememberWatched } from "@/components/queue/tabs";
import { I18nProvider, useSetLang, useT } from "@/components/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { Typed } from "@/components/prefs";
import { ThemeButton } from "@/components/theme-button";
import { Kbd } from "@/components/ui/kbd";
import { useNow } from "@/components/use-now";
import { MAIN, ROW, ROW_ROSTER, TEAMS_GRID } from "@/components/queue/geometry";
import { REVEAL, revealDuration, revealOrder } from "@/components/queue/reveal-order";
import { Avg, EMPTY_SLOT, EmptySlotBody, NameText, PlayerAvatar, RankText, slotLayout, Tag, TeamCardView, TeamCount, useLanding } from "@/components/queue/team-card";
import { SlimBar } from "@/components/status-page";
import { useWatch } from "@/components/watch/use-watch";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DrawEntry, GameEntry, WatchSnapshot } from "@/types/queue";

type Live = Exclude<WatchSnapshot, { disabled: true }>;
const SOURCE = "https://github.com/atlasatakahraman/TheAtlas-Queue";

// DESIGN.md § /watch/<channel>: read-only, public, mobile-first. The streamer chooses the sections
// (Teams, Queue, Games, Management); the reveal plays live; the entrance plays on load.
export function WatchView({ slug, initial }: { slug: string; initial: Live }) {
  const snap = useWatch(slug, initial);
  // The selection page's Continue and its recent channels (D19).
  useEffect(() => {
    rememberPlace(`/watch/${slug}`);
    rememberWatched(slug);
  }, [slug]);
  if (snap.disabled) return <WatchOff name={snap.channel.name} />;
  return (
    <I18nProvider labels={snap.labels ?? undefined}>
      <Page slug={slug} snap={snap} />
    </I18nProvider>
  );
}

// The page after the streamer turned it off while it was open (a load of a disabled page is the
// server's, with noindex).
function WatchOff({ name }: { name: string }) {
  const { t } = useT();
  return (
    <div className="flex min-h-dvh flex-col">
      <SlimBar crumb={name} tools={<Tools />} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-3 px-8 pb-[18vh] text-center max-md:px-4">
        <h1 className="font-serif text-title">{t("watch.disabled")}</h1>
        <p className="text-muted-foreground">{t("watch.disabled.hint")}</p>
      </main>
    </div>
  );
}

// EN | TR keeps the address in step (?lang), so the link a viewer shares opens in their language.
export function Tools() {
  const setLang = useSetLang();
  const pick = (l: Lang) => {
    setLang(l);
    const u = new URL(window.location.href);
    u.searchParams.set("lang", l);
    history.replaceState(history.state, "", u);
  };
  return (
    <>
      <LangSwitch onPick={pick} />
      <ThemeButton />
    </>
  );
}

function Page({ slug, snap }: { slug: string; snap: Live }) {
  const { t } = useT();
  const on = (s: Live["sections"][number]) => snap.sections.includes(s);
  const playing = useMemo(() => snap.players.filter((p) => p.status === "playing"), [snap.players]);
  const waiting = snap.players.filter((p) => p.status === "waiting");
  const reveal = useReveal(snap.draw);
  const rosters = useMemo(() => ([1, 2] as const).map((n) => playing.filter((p) => p.team === n)), [playing]);
  const landing = useLanding(reveal?.kind === "teams" ? reveal : null, rosters);
  const shown = [
    on("teams") && (playing.length > 0 || reveal),
    on("queue"),
    on("games"),
    on("moderation") && (snap.moderation?.length ?? 0) > 0,
  ];
  // The entrance (DESIGN.md § Motion): the title types, then each section rises 45ms apart.
  let step = 1;
  const enter = () => ({ className: "animate-enter", style: { animationDelay: `${70 + 45 * step++}ms` } });

  return (
    <div className="flex min-h-dvh flex-col">
      <SlimBar
        crumb={snap.channel.name}
        crumbHref="/?pick"
        home={`/watch/${slug}`}
        after={
          snap.channel.live && (
            <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-destructive">
              <Radio className="size-4" aria-hidden />
              {t("watch.live")}
            </span>
          )
        }
        tools={<Tools />}
      />
      <main className={cn(MAIN, "max-md:pb-8")}>
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-headline max-md:text-title">
            <Typed text={t("watch.title", { channel: snap.channel.name })} />
          </h1>
          <p className="animate-enter text-muted-foreground" style={{ animationDelay: "70ms" }}>{t("watch.subtitle")}</p>
          {snap.commands && <Commands commands={snap.commands} />}
        </header>
        {snap.rules && (
          <section className="animate-enter flex max-w-prose flex-col gap-2" style={{ animationDelay: "160ms" }} aria-labelledby="w-rules">
            <SectionHead id="w-rules" title={t("watch.rules")} />
            <p className="break-words whitespace-pre-line text-muted-foreground">{snap.rules}</p>
          </section>
        )}
        {!shown.some(Boolean) && <p className="text-muted-foreground">{t("watch.empty")}</p>}
        {shown[0] && (
          <section {...sec(enter(), "flex flex-col gap-4")} aria-labelledby="w-teams">
            <h2 id="w-teams" className="sr-only">{t("tab.teams")}</h2>
            <Headline score={snap.score} />
            {reveal?.kind === "pick" && <Picked entries={reveal.result.picked ?? []} />}
            <div className={TEAMS_GRID}>
              {rosters.map((roster, i) => (
                <TeamCard key={i} team={(i + 1) as 1 | 2} roster={roster} size={snap.team_size} landing={landing} />
              ))}
            </div>
          </section>
        )}
        {shown[1] && (
          <section {...sec(enter(), "flex flex-col gap-3")} aria-labelledby="w-queue">
            <SectionHead id="w-queue" title={t("tab.queue")} count={waiting.length} />
            {waiting.length === 0 ? (
              <p className="text-muted-foreground">{t("queue.empty.title")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {waiting.map((p, i) => (
                  <li key={p.id} className={cn(ROW, "grid-cols-[2rem_minmax(0,1fr)_auto] border-l-row-edge bg-row")}>
                    <span className="font-serif text-numeral text-muted-foreground tabular-nums">{i + 1}</span>
                    <Name name={p.kick_username} locked={p.locked} riot={p.riot_id} />
                    <RankText player={p} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
        {shown[2] && (
          <section {...sec(enter(), "grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6 max-lg:grid-cols-1")} aria-labelledby="w-games">
            <div className="flex flex-col gap-3">
              <SectionHead id="w-games" title={t("tab.games")} />
              {(snap.games?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">{t("watch.games.empty")}</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {snap.games!.map((g) => (
                    <GameRow key={g.n} n={g.n} winner={g.winner} ended={g.ended_at} teams={g.teams} />
                  ))}
                </ol>
              )}
            </div>
            {(snap.board?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="font-serif text-title">{t("watch.board")}</h3>
                <ol className="flex flex-col rounded-xl bg-card py-2">
                  {snap.board!.map((r, i) => (
                    <li key={r.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 px-4 py-2">
                      <span className="text-meta text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="truncate text-name">{r.name}</span>
                      <span className="font-serif font-medium text-brand tabular-nums">{r.wins}</span>
                      <span className={cn("font-serif font-medium tabular-nums", r.losses > 0 ? "text-destructive" : "text-muted-foreground")}>{r.losses}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}
        {shown[3] && (
          <section {...sec(enter(), "flex flex-col gap-3")} aria-labelledby="w-mod">
            <SectionHead id="w-mod" title={t("tab.moderation")} />
            {/* Names and kind only, never reasons (spec § Security). */}
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {snap.moderation!.map((m, i) => {
                const Icon = m.kind === "ban" ? Ban : m.kind === "punish" ? Gavel : TriangleAlert;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-name">{m.kick_username}</span>
                    <span className={cn("inline-flex items-center gap-1 text-meta font-medium", m.kind === "warn" ? "text-warning" : "text-destructive")}>
                      <Icon className="size-3.5" aria-hidden />
                      {t(`mod.kind.${m.kind}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      <footer className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 border-t border-border px-8 py-4 text-meta text-muted-foreground max-md:px-4">
        <span className="flex items-center gap-3">
          TheAtlas Queue
          <a className="underline-offset-4 hover:text-foreground hover:underline" href={SOURCE} rel="noopener">
            {t("source.link")}
          </a>
        </span>
      </footer>
    </div>
  );
}

// The channel's own chat commands (D33, owner 2026-09-29: always shown), each selectable so a
// viewer can copy it, and the way to the help page that explains them.
const COMMANDS = ["join", "leave", "position", "away", "perk"] as const;
function Commands({ commands }: { commands: NonNullable<Live["commands"]> }) {
  const { t, lang } = useT();
  return (
    <div className="animate-enter mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-control" style={{ animationDelay: "115ms" }}>
      <h2 className="sr-only">{t("watch.commands")}</h2>
      {COMMANDS.map((k) =>
        commands[k] ? (
          <span key={k} className="flex items-center gap-2">
            <span className="text-muted-foreground">{t(`settings.${k}_command`)}</span>
            <Kbd className="pointer-events-auto h-6 px-1.5 font-mono text-control text-foreground select-all">{commands[k]}</Kbd>
          </span>
        ) : null,
      )}
      <a
        href={`/wiki/chat-commands?lang=${lang}`}
        className="flex items-center gap-1.5 text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 max-md:min-h-11"
      >
        <CircleHelp className="size-4" aria-hidden />
        {t("watch.how")}
      </a>
    </div>
  );
}

const sec = (e: { className: string; style: React.CSSProperties }, cls: string) => ({ style: e.style, className: cn(e.className, cls) });

function SectionHead({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 font-serif text-title">
      {title}
      {count !== undefined && count > 0 && <span className="text-body text-muted-foreground tabular-nums">{count}</span>}
    </h2>
  );
}

// The match headline, as on the dashboard: Team 1 vs Team 2, this stream's score flanking vs.
function Headline({ score }: { score: Live["score"] }) {
  const { t } = useT();
  const played = score.t1 + score.t2 > 0;
  return (
    <p className="flex flex-wrap items-baseline justify-center gap-x-4 font-serif text-headline max-md:text-title">
      <span className="text-team-1">{t("team.1")}</span>
      <span className="flex items-baseline gap-4 max-md:gap-3">
        {played && <span className="font-medium text-team-1 tabular-nums">{score.t1}</span>}
        <span className="text-title text-muted-foreground italic max-md:text-body">{t("match.vs")}</span>
        {played && <span className="font-medium text-team-2 tabular-nums">{score.t2}</span>}
      </span>
      <span className="text-team-2">{t("team.2")}</span>
    </p>
  );
}

// A team card as the dashboard draws it (owner, 2026-09-28: one card), without its buttons, menus
// or drag: each player in their own slot (0028), gaps stay empty slots, and a fresh draw lands
// in the rosters themselves, typing each name in.
function TeamCard({ team, roster, size, landing }: { team: 1 | 2; roster: Live["players"]; size: number; landing: ReturnType<typeof useLanding> }) {
  return (
    <TeamCardView
      team={team}
      head={
        <span className="flex min-w-0 items-center gap-3">
          <TeamCount count={roster.length} size={size} />
          {!landing && <Avg players={roster} />}
        </span>
      }
    >
      {slotLayout(roster, size).map((p, n) =>
        p ? (
          <RosterRow key={p.id} player={p} n={n + 1} at={landing?.at.get(p.id)} />
        ) : (
          <div key={`slot-${n}`} className={EMPTY_SLOT}>
            <EmptySlotBody n={n + 1} />
          </div>
        ),
      )}
    </TeamCardView>
  );
}

// The dashboard's roster row (PlayerRow's "roster"): number, avatar, name#tag, tags, rank.
function RosterRow({ player, n, at }: { player: Live["players"][number]; n: number; at?: number }) {
  const { t } = useT();
  return (
    <div
      style={at === undefined ? undefined : { animationDelay: `${at}ms` }}
      className={cn(ROW, ROW_ROSTER, player.team === 2 ? "border-l-team-2" : "border-l-team-1", at !== undefined && "animate-enter")}
    >
      <span className="font-serif text-numeral text-muted-foreground tabular-nums select-none">{n}</span>
      <div className="flex min-w-0 items-center gap-3">
        <PlayerAvatar player={player} />
        <div className="@container/name flex min-w-0 flex-1 items-center gap-x-2.5">
          <NameText player={player} stacked={false} typeAt={at} />
          {player.locked && <Tag fold tone="brand" icon={ShieldCheck}>{t("tag.protected")}</Tag>}
        </div>
      </div>
      <div className="max-sm:hidden">
        <RankText player={player} />
      </div>
    </div>
  );
}

function Picked({ entries }: { entries: DrawEntry[] }) {
  const { t } = useT();
  return (
    <p className="flex flex-wrap items-baseline justify-center gap-x-3 text-body">
      <span className="text-muted-foreground">{t("watch.picked")}</span>
      {entries.map((e, i) => (
        <Typed key={e.id} text={e.kick_username} speed={REVEAL.speed} reveal={REVEAL.sharpen} startDelay={i * REVEAL.step} className="font-medium text-brand" />
      ))}
    </p>
  );
}

function Name({ name, locked, riot }: { name: string; locked: boolean; riot: string | null }) {
  const { t } = useT();
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-name">{name}</span>
        {locked && (
          <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-brand">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("tag.protected")}
          </span>
        )}
      </span>
      {riot && <span className="truncate text-meta text-muted-foreground">{riot}</span>}
    </span>
  );
}

function GameRow({ n, winner, ended, teams }: { n: number; winner: 1 | 2; ended: string; teams: [GameEntry[], GameEntry[]] }) {
  const { t, lang } = useT();
  const now = useNow(60_000);
  const at = new Date(ended);
  const today = now && new Date(now).toDateString() === at.toDateString();
  const time = now
    ? new Intl.DateTimeFormat(lang, today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at)
    : null;
  const tone = winner === 1 ? "text-team-1" : "text-team-2";
  const names = teams[winner - 1].map((e) => (e.removed ? null : e.kick_username)).filter(Boolean).join(", ");
  return (
    <li className={cn(ROW, "grid-cols-[3rem_minmax(0,1fr)_auto] bg-row", winner === 1 ? "border-l-team-1" : "border-l-team-2")}>
      <span className="font-serif text-numeral text-muted-foreground tabular-nums">#{n}</span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("flex items-center gap-2 font-medium", tone)}>
          <Trophy className="size-4 shrink-0" aria-hidden />
          {t("watch.won", { team: t(`team.${winner}`) })}
        </span>
        <span className="truncate text-meta text-muted-foreground">{names}</span>
      </span>
      <time dateTime={ended} className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">{time}</time>
    </li>
  );
}

// The draw reveal (spec § Realtime): a draw plays when it is new to this page, under 30 seconds
// old, and not played on this device before. The names type in as on the dashboard; then the
// rosters stand.
function useReveal(draw: Live["draw"]) {
  const [playing, setPlaying] = useState<Live["draw"]>(null);
  useEffect(() => {
    if (!draw || Date.now() - Date.parse(draw.created_at) > 30_000) return;
    try {
      if (localStorage.getItem("watch.played") === draw.id) return;
      localStorage.setItem("watch.played", draw.id);
    } catch {}
    const lists = draw.result.teams ?? [draw.result.picked ?? []];
    const t0 = setTimeout(() => setPlaying(draw), 0);
    const t1 = setTimeout(() => setPlaying(null), revealDuration(revealOrder(lists)) + (draw.kind === "pick" ? 8000 : 400));
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
    };
  }, [draw]);
  return playing;
}
