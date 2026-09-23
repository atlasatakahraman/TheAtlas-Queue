-- Schema for helpers the API never exposes (it is not in the API's exposed schemas).
-- authenticated needs usage for policies; service_role for check constraints on server inserts.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- One row per Kick login (streamers and moderators). id is the minted JWT's sub.
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  kick_user_id bigint not null unique,
  username     text not null check (length(username) between 1 and 64),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per onboarded Kick channel. kick_channel_id is the broadcaster's Kick user id.
create table public.channels (
  id                  uuid primary key default gen_random_uuid(),
  kick_channel_id     bigint not null unique,
  slug                text not null unique check (slug ~ '^[a-z0-9_-]{1,40}$'),
  display_name        text not null check (length(display_name) between 1 and 64),
  version             bigint not null default 0,
  live_since          timestamptz,
  last_command_at     timestamptz,
  subscriptions_ok_at timestamptz,
  subscription_error  text check (subscription_error is null or length(subscription_error) <= 200),
  created_at          timestamptz not null default now()
);

-- Who may run a channel's dashboard. Keyed by Kick user id so a moderator can be added before
-- they ever sign in, and so a username change keeps their access (spec D8).
create table public.channel_members (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  kick_user_id bigint not null,
  role         text not null check (role in ('owner', 'mod')),
  source       text not null check (source in ('owner', 'badge', 'manual')),
  blocked      boolean not null default false,
  last_seen_at timestamptz,
  added_by     bigint,
  created_at   timestamptz not null default now(),
  primary key (channel_id, kick_user_id),
  check ((role = 'owner') = (source = 'owner')),
  check (role <> 'owner' or not blocked)
);
create unique index channel_members_one_owner on public.channel_members (channel_id) where role = 'owner';
create index channel_members_by_user on public.channel_members (kick_user_id);

-- Curated label keys (DESIGN.md § Language and labels). A new key is a migration, on purpose.
create function private.labels_valid(l jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare loc text; v jsonb; k text; s jsonb;
begin
  if jsonb_typeof(l) <> 'object' then return false; end if;
  for loc, v in select * from jsonb_each(l) loop
    if loc not in ('en', 'tr') or jsonb_typeof(v) <> 'object' then return false; end if;
    for k, s in select * from jsonb_each(v) loop
      if k <> all (array[
        'brand.subtitle', 'team.1', 'team.2', 'match.vs',
        'queue.title', 'queue.hint', 'queue.empty.title', 'queue.empty.hint',
        'action.add', 'action.draw', 'action.reroll', 'action.pick',
        'watch.title', 'watch.subtitle', 'watch.disabled',
        'overlay.queue.title', 'overlay.draw.title',
        'chat.joined', 'chat.rejected.banned', 'chat.rejected.duplicate', 'chat.position', 'chat.perk'
      ]) then return false; end if;
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 80 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- CHECK constraints cannot hold subqueries, so "all five commands differ" lives here.
create function private.all_distinct(a text[]) returns boolean
language sql immutable set search_path = '' as $$
  select count(distinct lower(x)) = cardinality(a) from unnest(a) x
$$;

create table public.settings (
  channel_id       uuid primary key references public.channels(id) on delete cascade,
  join_command     text not null default '!sıra'  check (join_command ~ '^!\S{1,24}$'),
  leave_command    text not null default '!çık'   check (leave_command ~ '^!\S{1,24}$'),
  position_command text not null default '!sıram' check (position_command ~ '^!\S{1,24}$'),
  perk_command     text not null default '!hak'   check (perk_command ~ '^!\S{1,24}$'),
  away_command     text not null default '!afk'   check (away_command ~ '^!\S{1,24}$'),
  team_size        smallint not null default 5 check (team_size between 1 and 5),
  riot_enabled     boolean not null default true,
  require_riot_id  boolean not null default false,
  riot_region      text not null default 'tr1' check (riot_region in ('br1','eun1','euw1','jp1','kr','la1','la2','me1','na1','oc1','ph2','ru','sg2','th2','tr1','tw2','vn2')),
  fair_play        boolean not null default false,
  draw_reveal      text not null default 'typewriter' check (draw_reveal in ('typewriter', 'none')),
  stream_locale    text not null default 'en' check (stream_locale in ('en', 'tr')),
  watch_enabled    boolean not null default false,
  watch_sections   text[] not null default array['teams', 'queue'] check (watch_sections <@ array['teams', 'queue', 'moderation', 'riot_ids']),
  chat_replies     boolean not null default false,
  perk_enabled     boolean not null default false,
  perk_uses        smallint not null default 3 check (perk_uses between 1 and 30),
  perk_window_days smallint not null default 30 check (perk_window_days between 1 and 90),
  perk_badges      text[] not null default array['subscriber'] check (cardinality(perk_badges) <= 8),
  labels           jsonb not null default '{}'::jsonb check (private.labels_valid(labels)),
  updated_at       timestamptz not null default now(),
  -- The five commands must differ, or one message would mean two things.
  check (private.all_distinct(array[join_command, leave_command, position_command, perk_command, away_command]))
);

-- Role of the caller in a channel: 'owner', 'mod', or null (not a member, or blocked).
create function private.member_role(p_channel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.channel_members m
  join public.profiles p on p.kick_user_id = m.kick_user_id
  where m.channel_id = p_channel and p.id = (select auth.uid()) and not m.blocked
$$;
revoke execute on function private.member_role(uuid) from public, anon;
grant execute on function private.member_role(uuid) to authenticated;
-- The two validators are pure and harmless; anon still cannot reach them (no schema usage).

alter table public.profiles        enable row level security;
alter table public.channels        enable row level security;
alter table public.channel_members enable row level security;
alter table public.settings        enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy channels_select_member on public.channels
  for select to authenticated using (private.member_role(id) is not null);
create policy members_select_member on public.channel_members
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy settings_select_member on public.settings
  for select to authenticated using (private.member_role(channel_id) is not null);

-- Clients read; every write goes through RPCs (Stage 2 on).
revoke all on public.profiles, public.channels, public.channel_members, public.settings from anon, authenticated;
grant select on public.profiles, public.channels, public.channel_members, public.settings to authenticated;
