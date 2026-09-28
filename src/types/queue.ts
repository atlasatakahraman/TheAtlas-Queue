// What get_state returns and what the ch:<id> events carry (vault stage-2 contracts). Column
// names are the database's, unchanged, so a row from an event merges straight in.

export type Lang = "en" | "tr";
// punished: seated in Punished by an active punishment (0020); only settle or undo moves them.
export type Status = "waiting" | "playing" | "away" | "punished";
export type Role = "owner" | "mod";

export type Rank = {
  tier: string;
  division: string | null;
  lp: number | null;
  icon: number | null;
  wins?: number | null;
  losses?: number | null;
  level?: number | null;
} | null;

export type Player = {
  id: string;
  channel_id: string;
  kick_user_id: number | null;
  kick_username: string;
  riot_id: string | null;
  puuid: string | null;
  status: Status;
  team: 1 | 2 | null;
  locked: boolean;
  is_subscriber: boolean;
  badges: string[];
  games_played: number;
  joined_at: string;
  // The place in the order (0017): a drag moves it; the joined time stays.
  sort_key: number;
  // The slot on a team (0028, owner 2026-09-28): fixed, so a team can have gaps; null off a team.
  team_slot: number | null;
  source: "chat" | "manual";
  deleted_at: string | null;
  changed_v: number;
  changed_by: string | null;
  rank: Rank;
};

export type DrawEntry = { id: string; kick_username: string; locked: boolean };

export type Draw = {
  id: string;
  channel_id: string;
  kind: "teams" | "pick";
  n: number;
  result: { teams?: [DrawEntry[], DrawEntry[]]; picked?: DrawEntry[] };
  rerolled_from: string | null;
  created_by: string | null;
  created_at: string;
  undone_at: string | null;
};

// A recorded game (D27, 0027): both rosters as they stood, each player with their rank then. A
// player removed from all history leaves { removed: true } in their place. n is the channel's
// game number, never reused, so /games/<n> stays put.
export type GameEntry =
  | { id: string; kick_username: string; riot_id: string | null; locked: boolean; rank: Rank; removed?: undefined }
  | { removed: true };
export type Game = {
  id: string;
  channel_id: string;
  n: number;
  draw_id: string | null;
  winner: 1 | 2;
  teams: [GameEntry[], GameEntry[]];
  team_size: number;
  started_at: string | null;
  ended_at: string;
  recorded_by: string | null;
  removed_at: string | null;
};
// A name's record over the kept games; streak is signed (3 won in a row, -2 lost two).
export type PlayerRecord = {
  name: string;
  wins: number;
  losses: number;
  streak: number;
  best: number;
  last_game_at: string | null;
};
// This stream's score: games since the stream went live (or the last 12 hours offline).
export type Score = { since: string; t1: number; t2: number };
// A game's page (/c/<channel>/games/<n>): the game (null when removed or unknown), the numbers
// either side of it and the channel records of the names in it.
export type GameView = { n: number; game: Game | null; prev: number | null; next: number | null; records: PlayerRecord[] };

// What Victory does next (Settings, D27): record only, shuffle, a new draw from queue + teams or
// from the queue only, everyone back to the queue, losers back.
export const AFTER_GAME = ["none", "shuffle", "draw_all", "draw_queue", "queue", "losers"] as const;
export type AfterGame = (typeof AFTER_GAME)[number];

export type Sanction = {
  id: string;
  kick_username: string;
  kick_user_id: number | null;
  kind: "warn" | "punish" | "ban";
  level: 1 | 2 | null;
  games_left: number | null;
  expires_at: string | null;
  reason: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type Activity = {
  id: number;
  v: number;
  actor: string | null;
  action: string;
  target: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  undone_at: string | null;
};

export type Member = {
  channel_id: string;
  kick_user_id: number;
  kick_username: string | null;
  role: Role;
  source: "owner" | "badge" | "manual";
  blocked: boolean;
  last_seen_at: string | null;
  created_at: string;
};

export type Channel = {
  id: string;
  kick_channel_id: number;
  slug: string;
  display_name: string;
  live_since: string | null;
  stream_title: string | null;
  last_command_at: string | null;
  subscriptions_ok_at: string | null;
  subscription_error: string | null;
  created_at: string;
};

export type WatchSection = "teams" | "queue" | "moderation" | "riot_ids";

// How a draw shows itself (D22): a team draw lands by Typewriter unless "none"; a pick plays
// the chosen reveal.
export const DRAW_REVEALS = ["typewriter", "cards", "list", "wheel", "none"] as const;
export type DrawReveal = (typeof DRAW_REVEALS)[number];

export type Settings = {
  channel_id: string;
  join_command: string;
  leave_command: string;
  position_command: string;
  perk_command: string;
  away_command: string;
  team_size: number;
  riot_enabled: boolean;
  require_riot_id: boolean;
  riot_region: string;
  fair_play: boolean;
  draw_reveal: DrawReveal;
  clear_on_offline: boolean;
  after_game: AfterGame;
  games_retention_days: number;
  stream_locale: Lang;
  watch_enabled: boolean;
  watch_sections: WatchSection[];
  chat_replies: boolean;
  perk_enabled: boolean;
  perk_uses: number;
  perk_window_days: number;
  perk_badges: string[];
  labels: Partial<Record<Lang, Record<string, string>>>;
  updated_at: string;
};

export type QueueState = {
  v: number;
  role: Role;
  channel: Channel;
  settings: Settings;
  players: Player[];
  draw: Draw | null;
  moderation: Sanction[];
  respect: Record<string, number>;
  activity: Activity[];
  members: Member[];
  games: Game[];
  score: Score;
  records: PlayerRecord[];
};

// The dashboard's server actions (src/lib/server/dashboard.ts), handed down by the server page
// so no client file imports the server folder (check:secrets).
export type FoundKickUser = { ok: true; id: number; username: string } | { ok: false; error: "auth" | "not_found" | "kick" };
export type DashboardActions = {
  lookupRank: (channelId: string, riotId: string) => Promise<boolean>;
  refreshRank: (channelId: string, playerId: string) => Promise<"ok" | "recent" | "failed">;
  findKickUser: (channelId: string, username: string) => Promise<FoundKickUser>;
  reconnect: (channelId: string) => Promise<string | null>;
};

// One realtime event, and every mutating RPC's return value.
export type Row = { _t: string; _deleted?: true } & Record<string, unknown>;
export type ChangeEvent = { v: number; kind: string; rows: Row[]; actor: string | null };
