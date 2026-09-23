-- Server-only tables: RLS on and no policies, so only the secret key (and SQL functions owned
-- by postgres) can reach them.

-- Kick webhook dedupe, command messages only. Kept 1 hour.
create table public.webhook_events (
  message_id  text primary key check (length(message_id) <= 128),
  received_at timestamptz not null default now()
);
create index webhook_events_received on public.webhook_events (received_at);

-- Shared Riot rank cache across channels. 6 h freshness, purged after 7 days.
create table public.riot_cache (
  puuid         text primary key,
  game_name     text not null,
  tag_line      text not null,
  tier          text,
  division      text,
  league_points integer,
  icon          integer,
  fetched_at    timestamptz not null default now()
);
create index riot_cache_by_riot_id on public.riot_cache (lower(game_name), lower(tag_line));
create index riot_cache_fetched on public.riot_cache (fetched_at);

-- The streamer's Kick refresh token, only for chat replies (Stage 6). AES-256-GCM with
-- KICK_TOKEN_KEY, encrypted and decrypted in the Next server; Postgres holds ciphertext.
create table public.kick_tokens (
  channel_id        uuid primary key references public.channels(id) on delete cascade,
  refresh_token_enc bytea not null,
  expires_at        timestamptz not null,
  scopes            text[] not null default '{}'
);

alter table public.webhook_events enable row level security;
alter table public.riot_cache     enable row level security;
alter table public.kick_tokens    enable row level security;

revoke all on public.webhook_events, public.riot_cache, public.kick_tokens from anon, authenticated;
