// What get_state returns and what the ch:<id> events carry (vault stage-2 contracts). Column
// names are the database's, unchanged, so a row from an event merges straight in.

export type Lang = "en" | "tr";
export type Status = "waiting" | "playing" | "away";
export type Role = "owner" | "mod";

export type Rank = { tier: string; division: string | null; lp: number | null; icon: number | null } | null;

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
  last_command_at: string | null;
  subscriptions_ok_at: string | null;
  subscription_error: string | null;
  created_at: string;
};

export type WatchSection = "teams" | "queue" | "moderation" | "riot_ids";

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
  draw_reveal: "typewriter" | "none";
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
};

// The dashboard's server actions (src/lib/server/dashboard.ts), handed down by the server page
// so no client file imports the server folder (check:secrets).
export type FoundKickUser = { ok: true; id: number; username: string } | { ok: false; error: "auth" | "not_found" | "kick" };
export type DashboardActions = {
  lookupRank: (channelId: string, riotId: string) => Promise<boolean>;
  findKickUser: (channelId: string, username: string) => Promise<FoundKickUser>;
  reconnect: (channelId: string) => Promise<string | null>;
};

// One realtime event, and every mutating RPC's return value.
export type Row = { _t: string; _deleted?: true } & Record<string, unknown>;
export type ChangeEvent = { v: number; kind: string; rows: Row[]; actor: string | null };
