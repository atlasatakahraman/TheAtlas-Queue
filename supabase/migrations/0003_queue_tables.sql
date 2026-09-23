-- Settings → Moderators must name members who never signed in (badge-granted or pre-added).
alter table public.channel_members
  add column kick_username text check (kick_username is null or kick_username ~ '^\S{1,40}$');

-- The queue. Order is joined_at. changed_v/changed_by record the last write, so undo can tell
-- a row changed since and say who changed it (undo.changed).
create table public.players (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels(id) on delete cascade,
  kick_user_id  bigint,
  kick_username text not null check (kick_username ~ '^\S{1,40}$'),
  riot_id       text check (riot_id is null or riot_id ~ '^[^#]{3,16}#[A-Za-z0-9]{3,5}$'),
  puuid         text,
  status        text not null default 'waiting' check (status in ('waiting', 'playing', 'away')),
  team          smallint check (team in (1, 2)),
  locked        boolean not null default false,
  is_subscriber boolean not null default false,
  badges        text[] not null default '{}' check (cardinality(badges) <= 16),
  games_played  integer not null default 0 check (games_played >= 0),
  joined_at     timestamptz not null default now(),
  source        text not null check (source in ('chat', 'manual')),
  deleted_at    timestamptz,
  changed_v     bigint not null default 0,
  changed_by    text,
  check ((team is not null) = (status = 'playing'))
);
create index players_by_channel on public.players (channel_id, joined_at);
create index players_deleted on public.players (deleted_at) where deleted_at is not null;
-- Duplicate rejection, by name and by Kick user id (a renamed user must not hold two rows).
create unique index players_one_name on public.players (channel_id, lower(kick_username)) where deleted_at is null;
create unique index players_one_user on public.players (channel_id, kick_user_id)
  where deleted_at is null and kick_user_id is not null;

-- Persisted before any animation. request_id makes a retried draw idempotent.
create table public.draws (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels(id) on delete cascade,
  kind          text not null check (kind in ('teams', 'pick')),
  n             smallint not null check (n between 1 and 10),
  result        jsonb not null,
  rerolled_from uuid references public.draws(id) on delete set null,
  request_id    uuid not null unique,
  created_by    text,
  created_at    timestamptz not null default now(),
  undone_at     timestamptz
);
create index draws_by_channel on public.draws (channel_id, created_at desc);
create index draws_rerolled_from on public.draws (rerolled_from);

-- Subscriber perk: a rolling window over used_at, refunded rows excluded.
create table public.perk_uses (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels(id) on delete cascade,
  kick_user_id bigint not null,
  draw_id      uuid references public.draws(id) on delete set null,
  used_at      timestamptz not null default now(),
  refunded_at  timestamptz
);
create index perk_uses_by_user on public.perk_uses (channel_id, kick_user_id, used_at desc);
create index perk_uses_by_draw on public.perk_uses (draw_id);

-- Warnings, punishments (by games or by time) and bans. Kept with the channel: bans can be
-- permanent and respect decays over 30+ days. reason never leaves the dashboard.
create table public.moderation (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels(id) on delete cascade,
  kick_username text not null check (kick_username ~ '^\S{1,40}$'),
  kick_user_id  bigint,
  kind          text not null check (kind in ('warn', 'punish', 'ban')),
  level         smallint check (level in (1, 2)),
  games_left    smallint check (games_left between 0 and 10),
  expires_at    timestamptz,
  reason        text not null default '' check (length(reason) <= 200),
  created_by    text,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  check ((kind = 'warn') = (level is not null)),
  check (kind = 'punish' or games_left is null),
  check (kind <> 'punish' or ((games_left is null) <> (expires_at is null))),
  check (kind <> 'warn' or expires_at is null)
);
create index moderation_by_name on public.moderation (channel_id, lower(kick_username));
create index moderation_by_user on public.moderation (channel_id, kick_user_id) where kick_user_id is not null;

-- Written only inside RPCs: Moderation → Activity and the From chat feed. v is the channel
-- version the write produced; undo holds its inverse (stripped after 10 minutes).
create table public.activity (
  id         bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  v          bigint not null,
  actor      text,
  action     text not null,
  target     text,
  payload    jsonb not null default '{}'::jsonb,
  undo       jsonb,
  request_id uuid unique,
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
create index activity_by_channel on public.activity (channel_id, id desc);
create index activity_created on public.activity (created_at);

-- Fair-play counter: every transition into playing, by draw or by hand. An undo restores the
-- old count itself and sets queue.restoring so the restore is not counted as a new game.
create function private.count_game() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'playing' and (tg_op = 'INSERT' or old.status <> 'playing')
     and coalesce(current_setting('queue.restoring', true), '') <> 'on' then
    new.games_played := new.games_played + 1;
  end if;
  return new;
end $$;
revoke execute on function private.count_game() from public, anon, authenticated;
create trigger players_count_game before insert or update of status on public.players
  for each row execute function private.count_game();

alter table public.players    enable row level security;
alter table public.draws      enable row level security;
alter table public.perk_uses  enable row level security;
alter table public.moderation enable row level security;
alter table public.activity   enable row level security;

create policy players_select_member on public.players
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy draws_select_member on public.draws
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy perk_uses_select_member on public.perk_uses
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy moderation_select_member on public.moderation
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy activity_select_member on public.activity
  for select to authenticated using (private.member_role(channel_id) is not null);

-- Clients read; every write goes through RPCs.
revoke all on public.players, public.draws, public.perk_uses, public.moderation, public.activity from anon, authenticated;
revoke all on sequence public.activity_id_seq from anon, authenticated;
grant select on public.players, public.draws, public.perk_uses, public.moderation, public.activity to authenticated;
