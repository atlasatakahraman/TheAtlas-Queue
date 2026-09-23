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

export interface QueuePlayer {
  id: string;
  kickUsername: string;
  riotGameName: string;
  riotTagLine: string;
  joinedAt: Date;
  profileIconId?: number;
  summonerLevel?: number;
  rankedTier?: RankedTier;
  rankedDivision?: RankedDivision;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
  winRate?: number;
  isLoading?: boolean;
  hasError?: boolean;
  isAway?: boolean;
  isInGame?: boolean;
}

export interface Team {
  name: string;
  players: QueuePlayer[];
}

export interface TeamResult {
  teamA: Team;
  teamB: Team;
  createdAt: Date;
}

export interface AppSettings {
  riotApiKey: string;
  riotRegion: RiotRegion;
  riotRoutingRegion: RiotRoutingRegion;
  teamSize: number;
  kickChannelName: string;
  queueCommand: string;
  afkCommand: string;
  disableRiotApi?: boolean;
  manualChatroomId?: string;
  enableToasts?: boolean;
  pickAnimationStyle?: "classic" | "list" | "spin" | "none";
  pageTitle?: string;
  pageSubtitle?: string;
  emptyQueueTitle?: string;
  emptyQueueDescription?: string;
  queueCardTitle?: string;
  queueCardDescription?: string;
}

export interface KickChatMessage {
  id: string;
  sender: {
    username: string;
    slug: string;
  };
  content: string;
  createdAt: string;
}

export interface KickChannelInfo {
  id: number;
  slug: string;
  chatroom: {
    id: number;
  };
}

export type QueueAction =
  | { type: "ADD_PLAYER"; player: QueuePlayer }
  | { type: "REMOVE_PLAYER"; id: string }
  | { type: "UPDATE_PLAYER"; id: string; data: Partial<QueuePlayer> }
  | { type: "CLEAR_QUEUE" }
  | { type: "SET_QUEUE"; players: QueuePlayer[] };

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

export const REGION_LABELS: Record<RiotRegion, string> = {
  tr1: "Türkiye",
  euw1: "Batı Avrupa",
  eun1: "Kuzey & Doğu Avrupa",
  na1: "Kuzey Amerika",
  kr: "Kore",
  jp1: "Japonya",
  br1: "Brezilya",
  la1: "Latin Amerika Kuzey",
  la2: "Latin Amerika Güney",
  oc1: "Okyanusya",
  ru: "Rusya",
  ph2: "Filipinler",
  sg2: "Singapur",
  th2: "Tayland",
  tw2: "Tayvan",
  vn2: "Vietnam",
};

export const TIER_ORDER: Record<RankedTier, number> = {
  CHALLENGER: 12,
  GRANDMASTER: 11,
  MASTER: 10,
  DIAMOND: 9,
  EMERALD: 8,
  PLATINUM: 7,
  GOLD: 6,
  SILVER: 5,
  BRONZE: 4,
  IRON: 3,
  UNRANKED: 0,
};

export const TIER_LABELS: Record<RankedTier, string> = {
  CHALLENGER: "Şampiyon",
  GRANDMASTER: "Büyükusta",
  MASTER: "Usta",
  DIAMOND: "Elmas",
  EMERALD: "Zümrüt",
  PLATINUM: "Platin",
  GOLD: "Altın",
  SILVER: "Gümüş",
  BRONZE: "Bronz",
  IRON: "Demir",
  UNRANKED: "Derecesiz",
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
