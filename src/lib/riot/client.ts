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

/** Account API — regional routing */
export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
  region: RiotRegion,
): Promise<RiotAccountData | null> {
  const routing = REGION_TO_ROUTING[region];
  const url = `${REGIONAL_BASE(routing)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch<RiotAccountData>(url);
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

/** Fetch player data for queue (backward-compat wrapper) */
export async function fetchPlayerData(
  gameName: string,
  tagLine: string,
  opts: { apiKey?: string; region: RiotRegion },
) {
  const account = await getAccountByRiotId(gameName, tagLine, opts.region);
  if (!account) return null;

  const summoner = await getSummonerByPuuid(account.puuid, opts.region);
  if (!summoner) return null;

  const entries = await getRankedEntries(account.puuid, opts.region);

  const soloQ = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  const flexQ = entries.find((e) => e.queueType === "RANKED_FLEX_SR");
  const bestQ = soloQ ?? flexQ;

  const wins = bestQ?.wins ?? 0;
  const losses = bestQ?.losses ?? 0;
  const totalGames = wins + losses;

  return {
    profileIconId: summoner.profileIconId,
    summonerLevel: summoner.summonerLevel,
    rankedTier: bestQ?.tier ?? "UNRANKED",
    rankedDivision: bestQ?.rank ?? "IV",
    leaguePoints: bestQ?.leaguePoints ?? 0,
    wins,
    losses,
    winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
  };
}
