"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { useQueue, useServerActions, useStore } from "@/components/queue/store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/components/use-now";
import { ago, span } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Channel } from "@/types/queue";

type Health = "live" | "listening" | "delayed" | "down";

const QUIET_MS = 10 * 60_000;
// The health check runs every 10 minutes; three missed runs mean the check itself is failing.
const STALE_MS = 30 * 60_000;

// Whether commands from chat are reaching Queue (DESIGN.md § Connection health), from the
// server's view of the Kick subscriptions, never from this browser's socket.
export function health(c: Channel, now: number): Health {
  if (!c.subscriptions_ok_at) return "down";
  if (c.subscription_error || (now > 0 && now - Date.parse(c.subscriptions_ok_at) > STALE_MS)) return "delayed";
  if (c.last_command_at && (now === 0 || now - Date.parse(c.last_command_at) < QUIET_MS)) return "live";
  return "listening";
}

const DOT: Record<Health, string> = {
  live: "bg-success ring-4 ring-success/25",
  listening: "bg-muted-foreground",
  delayed: "bg-warning",
  down: "bg-destructive",
};

// Re-creates the Kick subscriptions now; the pill and the page's right-click menu both offer it.
export function useReconnect() {
  const { t } = useT();
  const store = useStore();
  const channelId = useQueue((v) => v.channel.id);
  const [busy, setBusy] = useState(false);
  const { reconnect } = useServerActions();
  async function run() {
    setBusy(true);
    const error = await reconnect(channelId);
    await store.refetch();
    setBusy(false);
    if (error) toast.error(t("pill.reconnect.failed"));
  }
  return { busy, reconnect: run };
}

export function ConnectionPill() {
  const { t } = useT();
  const channel = useQueue((v) => v.channel);
  const now = useNow();
  const state = health(channel, now);
  const { busy, reconnect } = useReconnect();

  // Only Not connected ever raises a toast (DESIGN.md § Connection health).
  const prev = useRef(state);
  useEffect(() => {
    if (state === "down" && prev.current !== "down") toast.error(t("pill.toast.down"));
    prev.current = state;
  }, [state, t]);

  const long =
    state === "live"
      ? t("pill.live", { t: now ? ago(channel.last_command_at!, now, t) : "" })
      : state === "listening"
        ? channel.last_command_at && now
          ? t("pill.listening", { t: span(now - Date.parse(channel.last_command_at), t) })
          : t("pill.listening.never")
        : t(`pill.${state}`);
  const short = t(`pill.short.${state}`);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-full border border-input px-3 text-control outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-11"
        >
          <span className={cn("size-2 rounded-full", DOT[state])} aria-hidden />
          <span className="max-md:hidden">{long}</span>
          <span className="md:hidden">{short}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 rounded-xl p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-meta">
          <dt className="text-muted-foreground">{t("pill.details.subs")}</dt>
          <dd>{channel.subscriptions_ok_at && !channel.subscription_error ? t("pill.details.ok") : t("pill.details.missing")}</dd>
          <dt className="text-muted-foreground">{t("pill.details.last_event")}</dt>
          <dd>{channel.last_command_at && now ? ago(channel.last_command_at, now, t) : t("pill.details.never")}</dd>
          <dt className="text-muted-foreground">{t("pill.details.last_check")}</dt>
          <dd>{channel.subscriptions_ok_at && now ? ago(channel.subscriptions_ok_at, now, t) : t("pill.details.never")}</dd>
        </dl>
        {channel.subscription_error && (
          <p className="text-meta text-muted-foreground">
            {t("pill.details.error")} <span className="font-mono text-code">{channel.subscription_error}</span>
          </p>
        )}
        {(state === "down" || state === "delayed") && (
          <Button size="lg" variant="outline" disabled={busy} onClick={() => void reconnect()}>
            {busy ? t("pill.reconnecting") : t("pill.reconnect")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
