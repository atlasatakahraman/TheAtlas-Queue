export type RiotRegion =
  | "tr1"
  | "euw1"
  | "eun1"
  | "na1"
  | "kr"
  | "jp1"
  | "br1"
  | "la1"
  | "la2"
  | "oc1"
  | "ru"
  | "ph2"
  | "sg2"
  | "th2"
  | "tw2"
  | "vn2";

export type RiotRoutingRegion = "europe" | "americas" | "asia" | "sea";

export type RankedTier =
  | "IRON"
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "EMERALD"
  | "DIAMOND"
  | "MASTER"
  | "GRANDMASTER"
  | "CHALLENGER"
  | "UNRANKED";

export type RankedDivision = "I" | "II" | "III" | "IV";

export interface RiotAccountData {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface RiotSummonerData {
  id: string;
  accountId: string;
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
}

export interface RiotRankedEntry {
  queueType: string;
  tier: RankedTier;
  rank: RankedDivision;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export const REGION_TO_ROUTING: Record<RiotRegion, RiotRoutingRegion> = {
  tr1: "europe",
  euw1: "europe",
  eun1: "europe",
  ru: "europe",
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  kr: "asia",
  jp1: "asia",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea",
  oc1: "sea",
};

// /welcome step 1 (Stage 3): what the onboarding server action returns to the page.
export type OnboardSettings = {
  join_command: string;
  require_riot_id: boolean;
  riot_region: string;
  stream_locale: "en" | "tr";
};
export type Onboarded =
  | { ok: true; channelId: string; slug: string; subscriptionError: string | null; settings: OnboardSettings }
  | { ok: false; error: "auth" | "kick" | "slug" | "db" };
