import "server-only";

import type { RiotRegion, RiotRoutingRegion } from "@/types";
import { REGION_TO_ROUTING } from "@/types";
import type {
  RiotAccountData,
  RiotSummonerData,
  RiotRankedEntry,
} from "@/types";

const RIOT_API_KEY = process.env.RIOT_API_KEY ?? "";

const PLATFORM_BASE = (region: RiotRegion) =>
  `https://${region}.api.riotgames.com`;

const REGIONAL_BASE = (routing: RiotRoutingRegion) =>
  `https://${routing}.api.riotgames.com`;

interface RiotFetchOptions {
  timeout?: number;
  maxRetries?: number;
}

interface RiotFetchResult<T> {
  data: T | null;
  status: number;
  statusText: string;
  url: string;
}

class RiotApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public retryAfter?: number,
  ) {
    super(`Riot API ${status}: ${statusText}`);
    this.name = "RiotApiError";
  }
}

async function riotFetch<T>(
  url: string,
  options: RiotFetchOptions = {},
): Promise<T | null> {
  const result = await riotFetchWithMeta<T>(url, options);
  return result.data;
}

async function riotFetchWithMeta<T>(
  url: string,
  options: RiotFetchOptions = {},
): Promise<RiotFetchResult<T>> {
  const { timeout = 8000, maxRetries = 2 } = options;

  let lastStatus = 0;
  let lastStatusText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        headers: {
          "X-Riot-Token": RIOT_API_KEY,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);
      lastStatus = res.status;
      lastStatusText = res.statusText;

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        if (attempt < maxRetries) {
          await sleep(retryAfter * 1000);
          continue;
        }
        return { data: null, status: res.status, statusText: res.statusText, url };
      }

      if (res.status === 404) {
        return { data: null, status: 404, statusText: "Not Found", url };
      }

      if (!res.ok) {
        if (attempt < maxRetries && res.status >= 500) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        return { data: null, status: res.status, statusText: res.statusText, url };
      }

      const data = (await res.json()) as T;
      return { data, status: res.status, statusText: res.statusText, url };
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return { data: null, status: lastStatus || 0, statusText: (err as Error)?.message ?? "Network error", url };
    }
  }

  return { data: null, status: lastStatus, statusText: lastStatusText, url };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Summoner-v4 — platform routing */
export async function getSummonerByPuuid(
  puuid: string,
  region: RiotRegion,
): Promise<RiotSummonerData | null> {
  const url = `${PLATFORM_BASE(region)}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return riotFetch<RiotSummonerData>(url);
}

/** League-v4 ranked entries — platform routing */
export async function getRankedEntries(
  puuid: string,
  region: RiotRegion,
): Promise<RiotRankedEntry[]> {
  const url = `${PLATFORM_BASE(region)}/lol/league/v4/entries/by-puuid/${puuid}`;
  const data = await riotFetch<RiotRankedEntry[]>(url);
  return data ?? [];
}

let pausedUntil = 0;

/**
 * Rank for a Riot ID, for the webhook's after() (spec § Flows → Join). Null when the account is
 * not found or Riot is unavailable; never throws. 429 is honoured inside riotFetchWithMeta; a
 * 401/403 (expired or revoked key) pauses Riot on this instance for 10 minutes with one log line.
 */
export async function fetchRank(riotId: string, region: string) {
  if (!RIOT_API_KEY || Date.now() < pausedUntil) return null;
  const [gameName, tagLine] = riotId.split("#");
  const routing = REGION_TO_ROUTING[region as RiotRegion] ?? "europe";
  const account = await riotFetchWithMeta<RiotAccountData>(
    `${REGIONAL_BASE(routing)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
  if (account.status === 401 || account.status === 403) {
    pausedUntil = Date.now() + 10 * 60_000;
    console.error(JSON.stringify({ route: "riot", error: account.status, paused: "10m" }));
    return null;
  }
  if (!account.data) return null;

  const platform = region as RiotRegion;
  const [summoner, entries] = await Promise.all([
    getSummonerByPuuid(account.data.puuid, platform),
    getRankedEntries(account.data.puuid, platform),
  ]);
  const best = entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? entries.find((e) => e.queueType === "RANKED_FLEX_SR");
  return {
    puuid: account.data.puuid,
    gameName: account.data.gameName,
    tagLine: account.data.tagLine,
    tier: best?.tier ?? null,
    division: best?.rank ?? null,
    lp: best?.leaguePoints ?? null,
    icon: summoner?.profileIconId ?? null,
  };
}
