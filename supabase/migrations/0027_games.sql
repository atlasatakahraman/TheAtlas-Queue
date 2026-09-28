-- Game history (D27, D28, Stage 10): Victory records a game in one write (both rosters with each
-- player's rank then, the winner, start, end), serves one game of every game-count punishment,
-- and runs the channel's after-game action. Records per name are kept in the same write, so a
-- W / L read never counts games. Contracts: vault stages/2026-09-28-queue-rewrite-stage-10.md.

-- The after-game action (default record only) and how long games are kept.
alter table public.settings add column after_game text not null default 'none'
  check (after_game in ('none', 'shuffle', 'draw_all', 'draw_queue', 'queue', 'losers'));
alter table public.settings add column games_retention_days smallint not null default 90
  check (games_retention_days between 1 and 365);

create or replace function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline', 'after_game', 'games_retention_days']
$$;

-- A game: teams is [[team 1], [team 2]], each player {id, kick_username, riot_id, locked, rank}
-- as they stood. n numbers a channel's games and is never reused, so /games/<n> stays put.
-- removed_at: taken back (undo, Remove this game, Clear games); retention deletes it after the
-- 10-minute undo window.
create table public.games (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels(id) on delete cascade,
  n           integer not null check (n > 0),
  draw_id     uuid references public.draws(id) on delete set null,
  winner      smallint not null check (winner in (1, 2)),
  teams       jsonb not null check (jsonb_typeof(teams) = 'array' and jsonb_array_length(teams) = 2),
  team_size   smallint not null,
  started_at  timestamptz,
  ended_at    timestamptz not null default now(),
  recorded_by text,
  request_id  uuid not null unique,
  removed_at  timestamptz,
  unique (channel_id, n)
);
create index games_by_channel on public.games (channel_id, ended_at desc);
create index games_draw on public.games (draw_id);
create index games_removed on public.games (removed_at) where removed_at is not null;

-- Who played which game, by lower-cased Kick name: the search and the records read this.
create table public.game_players (
  game_id       uuid not null references public.games(id) on delete cascade,
  channel_id    uuid not null references public.channels(id) on delete cascade,
  name          text not null check (name = lower(name)),
  kick_username text not null,
  riot_id       text,
  team          smallint not null check (team in (1, 2)),
  won           boolean not null,
  primary key (game_id, name)
);
create index game_players_by_name on public.game_players (channel_id, name);

-- A name's record over the kept games: streak is signed (3 = won the last three, -2 = lost the
-- last two), best is the longest run of wins.
create table public.player_records (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  name         text not null,
  wins         integer not null default 0,
  losses       integer not null default 0,
  streak       integer not null default 0,
  best         integer not null default 0,
  last_game_at timestamptz,
  primary key (channel_id, name)
);

alter table public.games          enable row level security;
alter table public.game_players   enable row level security;
alter table public.player_records enable row level security;
create policy games_select_member on public.games
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy game_players_select_member on public.game_players
  for select to authenticated using (private.member_role(channel_id) is not null);
create policy player_records_select_member on public.player_records
  for select to authenticated using (private.member_role(channel_id) is not null);
revoke all on public.games, public.game_players, public.player_records from anon, authenticated;
grant select on public.games, public.game_players, public.player_records to authenticated;

-- "This stream": since the stream went live, or the last 12 hours while offline.
create function private.session_start(p_channel uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(c.live_since, now() - interval '12 hours') from public.channels c where c.id = p_channel
$$;

-- This stream's score as an event row.
create function private.score(p_channel uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('_t', 'score', 'since', x.s,
    't1', count(g.id) filter (where g.winner = 1), 't2', count(g.id) filter (where g.winner = 2))
  from (select private.session_start(p_channel) s) x
  left join public.games g on g.channel_id = p_channel and g.removed_at is null and g.ended_at >= x.s
  group by x.s
$$;

create function private.game_json(g public.games) returns jsonb
language sql stable set search_path = '' as $$
  select (to_jsonb(g) - 'request_id') || '{"_t":"games"}'::jsonb
$$;

-- Recounts the records of p_names from the games kept, and returns them as event rows (a name
-- with no game left as a tombstone). Every write that adds, removes or restores a game calls it
-- for the names in that game, so records never need inverse arithmetic.
create function private.recount(p_channel uuid, p_names text[]) returns jsonb
language plpgsql set search_path = '' as $$
begin
  delete from public.player_records r where r.channel_id = p_channel and r.name = any(p_names);
  insert into public.player_records (channel_id, name, wins, losses, streak, best, last_game_at)
  with g as (
    select gp.name, gp.won, x.ended_at, x.n,
      row_number() over (partition by gp.name order by x.ended_at, x.n)
        - row_number() over (partition by gp.name, gp.won order by x.ended_at, x.n) as run
    from public.game_players gp join public.games x on x.id = gp.game_id
    where gp.channel_id = p_channel and gp.name = any(p_names) and x.removed_at is null
  ), runs as (
    select g.name, g.won, count(*)::integer as len, max(g.ended_at) as at, max(g.n) as last_n
    from g group by g.name, g.won, g.run
  ), latest as (
    select distinct on (r.name) r.name, case when r.won then r.len else -r.len end as streak
    from runs r order by r.name, r.at desc, r.last_n desc
  )
  select p_channel, g.name, count(*) filter (where g.won), count(*) filter (where not g.won), l.streak,
    coalesce((select max(r.len) from runs r where r.name = g.name and r.won), 0), max(g.ended_at)
  from g join latest l on l.name = g.name
  group by g.name, l.streak;

  return (
    select coalesce(jsonb_agg(coalesce(to_jsonb(r) || '{"_t":"player_records"}'::jsonb,
                                       jsonb_build_object('_t', 'player_records', 'name', u.n, '_deleted', true))), '[]'::jsonb)
    from (select distinct x as n from unnest(p_names) x) u
    left join public.player_records r on r.channel_id = p_channel and r.name = u.n);
end $$;

revoke execute on function private.session_start(uuid) from public, anon, authenticated;
revoke execute on function private.score(uuid) from public, anon, authenticated;
revoke execute on function private.game_json(public.games) from public, anon, authenticated;
revoke execute on function private.recount(uuid, text[]) from public, anon, authenticated;

-- Team draw, or reroll of the standing team draw. Pool: waiting, not deleted, not sanctioned.
-- Fresh draw: everyone playing returns to the pool, protections end, and every game-count
-- punishment serves one game (until 0027). Reroll: protected players keep their team, the rest are drawn
-- again and give back the game the thrown-out draw counted. With fair-play on, the fewest
-- games_played win the slots; ties and everything else are random. Selected players are
-- split at random, as evenly as possible, team 1 taking the odd one. 0027: a game-count
-- punishment is served by a recorded game, not a draw (D27, DESIGN.md § Punished players), and
-- queue.draw_exclude (set by record_game's *new draw from queue only*) keeps players out.
create or replace function public.draw_teams(p_channel uuid, p_base uuid, p_reroll boolean, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b           record;
  s           public.settings;
  v_latest    public.draws;
  v_prior     public.draws;
  v_draw      public.draws;
  v_before    jsonb;
  v_mod       jsonb;
  v_mod_ids   uuid[];
  v_mod_names text[];
  v_fixed1    integer;
  v_fixed2    integer;
  v_cap1      integer;
  v_cap2      integer;
  v_pool      uuid[];
  v_sel       uuid[];
  v_n         integer;
  v_total     integer;
  v_need1     integer;
  v_need2     integer;
  v_perk      uuid[];
  v_uses      uuid[];
  v_rows      jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_reroll is null then perform private.fail('request.invalid'); end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  select * into s from public.settings x where x.channel_id = p_channel;

  if p_reroll then
    select d.* into v_prior from public.draws d
    where d.channel_id = p_channel and d.undone_at is null and d.kind = 'teams'
    order by d.created_at desc limit 1;
    p_reroll := found;  -- nothing to reroll: a fresh draw
  end if;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_before
  from public.players p where p.channel_id = p_channel and p.deleted_at is null;

  if p_reroll then
    update public.players p set status = 'waiting', team = null,
      games_played = case
        when p.id in (select (e #>> '{}')::uuid from jsonb_path_query(v_prior.result, '$.teams[*][*].id') e)
        then greatest(p.games_played - 1, 0) else p.games_played end,
      changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and not p.locked;
  else
    update public.players p set status = 'waiting', team = null, locked = false,
      changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and (p.status = 'playing' or p.locked);
  end if;

  select count(*) filter (where p.team = 1), count(*) filter (where p.team = 2) into v_fixed1, v_fixed2
  from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';
  v_cap1 := greatest(s.team_size - v_fixed1, 0);
  v_cap2 := greatest(s.team_size - v_fixed2, 0);

  -- Sanctions are read before this draw serves a game: a 1-game punishment sits this one out.
  select coalesce(array_agg(p.id order by case when s.fair_play then p.games_played else 0 end,
                                          extensions.gen_random_bytes(8)), '{}')
  into v_pool
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'waiting'
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null
    and p.id::text <> all (string_to_array(coalesce(current_setting('queue.draw_exclude', true), ''), ','));

  v_n := least(cardinality(v_pool), v_cap1 + v_cap2);
  v_total := v_n + v_fixed1 + v_fixed2;
  if v_total < 2 then perform private.fail('draw.not_enough'); end if;
  v_need1 := least(greatest(ceil(v_total / 2.0)::integer - v_fixed1, 0), v_cap1, v_n);
  v_need2 := v_n - v_need1;
  if v_need2 > v_cap2 then
    v_need1 := v_need1 + v_need2 - v_cap2;
    v_need2 := v_cap2;
  end if;

  select coalesce(array_agg(x order by extensions.gen_random_bytes(8)), '{}') into v_sel
  from unnest(v_pool[1:v_n]) x;
  update public.players p set status = 'playing',
    team = case when p.id = any(v_sel[1:v_need1]) then 1 else 2 end,
    changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_sel);

  v_perk := private.apply_perk(p_channel, v_sel, b.next_v, b.actor);

  insert into public.draws (channel_id, kind, n, result, rerolled_from, request_id, created_by)
  values (p_channel, 'teams', s.team_size,
    jsonb_build_object('teams', jsonb_build_array(
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'locked', p.locked)
                                 order by p.locked desc, p.joined_at), '[]'::jsonb)
       from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.team = 1),
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'locked', p.locked)
                                 order by p.locked desc, p.joined_at), '[]'::jsonb)
       from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.team = 2))),
    case when p_reroll then v_prior.id end, coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  with u as (
    insert into public.perk_uses (channel_id, kick_user_id, draw_id)
    select p_channel, p.kick_user_id, v_draw.id from public.players p where p.id = any(v_perk)
    returning id)
  select coalesce(array_agg(u.id), '{}') into v_uses from u;

  v_rows := jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb);
  if v_mod_ids is not null then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod_ids, v_mod_names);
  end if;
  return private.commit(p_channel, b.next_v, b.actor,
    case when p_reroll then 'reroll' else 'draw_teams' end, null,
    jsonb_build_object('draw', v_draw.id),
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_before) e
                  join public.players p on p.id = (e ->> 'id')::uuid where p.changed_v = b.next_v),
      'inserted_perk_uses', to_jsonb(v_uses),
      'moderation', coalesce(v_mod, '[]'::jsonb),
      'draw', v_draw.id),
    p_request_id, v_rows);
end $$;

create or replace function public.undo(p_channel uuid, p_activity bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  a        public.activity;
  v_by     text;
  v_mod    uuid[];
  v_names  text[];
  v_rows   jsonb := '[]'::jsonb;
  v_then   bigint;
  v_games  uuid[];
  v_gnames text[];
begin
  -- Victory with a draw after it wrote two activities; the game's names the draw (then), which
  -- is undone first, in its own write, so the game's players are as the game left them.
  select (x.undo ->> 'then')::bigint into v_then from public.activity x
  where x.id = p_activity and x.channel_id = p_channel and x.undone_at is null;
  if v_then is not null and exists (select 1 from public.activity x
                                    where x.id = v_then and x.undone_at is null and x.undo is not null) then
    perform public.undo(p_channel, v_then, null);
  end if;

  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;

  select * into a from public.activity x where x.id = p_activity and x.channel_id = p_channel for update;
  if not found or a.undo is null or a.undone_at is not null then
    perform private.fail('undo.changed', jsonb_build_object('by', null));
  end if;

  select p.changed_by into v_by from public.players p
  where p.channel_id = p_channel and p.changed_v <> a.v
    and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e
                 union all
                 select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e)
  limit 1;
  if found then perform private.fail('undo.changed', jsonb_build_object('by', v_by)); end if;

  -- Players: restore the captured rows (their old games_played included, so the trigger must
  -- not count the restore) and soft-delete the ones the write inserted.
  perform set_config('queue.restoring', 'on', true);
  begin
    update public.players p set
      status = r.status, team = r.team, locked = r.locked, deleted_at = r.deleted_at,
      kick_username = r.kick_username, riot_id = r.riot_id, puuid = r.puuid,
      games_played = r.games_played, sort_key = coalesce(r.sort_key, p.sort_key), changed_v = r.changed_v, changed_by = r.changed_by
    from jsonb_populate_recordset(null::public.players, coalesce(a.undo -> 'players', '[]'::jsonb)) r
    where p.id = r.id and p.channel_id = p_channel;
  exception when unique_violation then
    perform private.fail('queue.duplicate');
  end;
  perform set_config('queue.restoring', 'off', true);
  v_rows := v_rows || coalesce((
    select jsonb_agg(private.player_json(p)) from public.players p
    where p.channel_id = p_channel
      and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e)), '[]'::jsonb);
  update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
  where p.channel_id = p_channel and p.deleted_at is null
    and p.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e);

  -- Moderation: upsert captured rows (brings back a deleted or revoked sanction, or a served
  -- game), delete inserted ones.
  select array_agg(r.id), array_agg(r.kick_username) into v_mod, v_names
  from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r;
  insert into public.moderation
  select r.* from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r
  where r.channel_id = p_channel
  on conflict (id) do update set revoked_at = excluded.revoked_at, games_left = excluded.games_left,
    expires_at = excluded.expires_at;
  with d as (
    delete from public.moderation m
    where m.channel_id = p_channel
      and m.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_moderation', '[]'::jsonb)) e)
    returning m.id, m.kick_username)
  select coalesce(v_mod, '{}') || coalesce(array_agg(d.id), '{}'), coalesce(v_names, '{}') || coalesce(array_agg(d.kick_username), '{}')
  into v_mod, v_names from d;
  if cardinality(v_mod) > 0 then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod, v_names);
  end if;

  -- Perk uses: restore refunds, drop the ones the write consumed.
  update public.perk_uses u set refunded_at = r.refunded_at
  from jsonb_populate_recordset(null::public.perk_uses, coalesce(a.undo -> 'perk_uses', '[]'::jsonb)) r
  where u.id = r.id and u.channel_id = p_channel;
  delete from public.perk_uses u
  where u.channel_id = p_channel
    and u.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_perk_uses', '[]'::jsonb)) e);

  -- Draw: mark it undone; the previous one is the current result again.
  if a.undo ? 'draw' then
    update public.draws d set undone_at = now()
    where d.id = (a.undo ->> 'draw')::uuid and d.channel_id = p_channel;
    v_rows := v_rows || coalesce((
      select jsonb_agg(to_jsonb(d) || '{"_t":"draws"}'::jsonb)
      from public.draws d
      where d.id = (a.undo ->> 'draw')::uuid
         or d.id = (select x.id from public.draws x where x.channel_id = p_channel and x.undone_at is null
                    order by x.created_at desc limit 1)), '[]'::jsonb);
  end if;

  -- Games: a recorded game is removed; a removed or cleared one comes back; a forgotten
  -- person's rows and names come back. Records are recounted for every name involved.
  if a.undo ? 'game' then
    update public.games g set removed_at = now()
    where g.id = (a.undo ->> 'game')::uuid and g.channel_id = p_channel;
    v_games := array[(a.undo ->> 'game')::uuid];
  end if;
  if a.undo ? 'games' then
    select array_agg((e #>> '{}')::uuid) into v_games from jsonb_array_elements(a.undo -> 'games') e;
    update public.games g set removed_at = null where g.channel_id = p_channel and g.id = any(v_games);
  end if;
  if a.undo ? 'game_teams' then
    update public.games g set teams = r.teams
    from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb)
    where g.id = r.id and g.channel_id = p_channel;
    insert into public.game_players
    select r.* from jsonb_populate_recordset(null::public.game_players, a.undo -> 'game_players') r
    where r.channel_id = p_channel
    on conflict do nothing;
    select array_agg(r.id) into v_games from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb);
  end if;
  if v_games is not null then
    select coalesce(array_agg(distinct gp.name), '{}') into v_gnames
    from public.game_players gp where gp.game_id = any(v_games);
    v_rows := v_rows || case when cardinality(v_games) > 20 then jsonb_build_array(jsonb_build_object('_t', 'games_reload'))
                             else coalesce((select jsonb_agg(private.game_json(g)) from public.games g
                                            where g.id = any(v_games)), '[]'::jsonb) end
      || private.recount(p_channel, v_gnames) || jsonb_build_array(private.score(p_channel));
  end if;

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $$;

create or replace function public.get_state(p_channel uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
begin
  v_role := private.member_role(p_channel);
  if v_role is null then perform private.fail('auth.not_member'); end if;
  return (
    select jsonb_build_object(
      'v', c.version,
      'role', v_role,
      'channel', to_jsonb(c) - 'version',
      'settings', (select to_jsonb(s) from public.settings s where s.channel_id = c.id),
      'players', (select coalesce(jsonb_agg(private.player_json(p) order by p.joined_at), '[]'::jsonb)
                  from public.players p where p.channel_id = c.id and p.deleted_at is null),
      'draw', (select to_jsonb(d) from public.draws d
               where d.channel_id = c.id and d.undone_at is null order by d.created_at desc limit 1),
      'moderation', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
                     from (select * from public.moderation x where x.channel_id = c.id
                           order by x.created_at desc limit 500) m),
      'respect', (select coalesce(jsonb_object_agg(u.n, private.respect(c.id, u.n)), '{}'::jsonb)
                  from (select distinct lower(x.kick_username) as n from public.moderation x where x.channel_id = c.id) u),
      'activity', (select coalesce(jsonb_agg(to_jsonb(a) - 'undo' order by a.id desc), '[]'::jsonb)
                   from (select * from public.activity x where x.channel_id = c.id order by x.id desc limit 100) a),
      'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
                  from public.channel_members m where m.channel_id = c.id),
      -- 0027: the last 20 games, this stream's score, and the records of everyone queued.
      'games', (select coalesce(jsonb_agg(to_jsonb(g) order by g.n desc), '[]'::jsonb)
                from (select * from public.games x where x.channel_id = c.id and x.removed_at is null
                      order by x.n desc limit 20) g),
      'score', private.score(c.id) - '_t',
      'records', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from public.player_records r
                  where r.channel_id = c.id and r.name in (select lower(p.kick_username) from public.players p
                                                            where p.channel_id = c.id and p.deleted_at is null))
    )
    from public.channels c where c.id = p_channel
  );
end $$;

create or replace function public.update_settings(p_channel uuid, p_patch jsonb, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_row  public.settings;
  v_key  text;
  v_c    text;
  v_rows jsonb;
  v_was  boolean;
  v_n    integer := 0;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then perform private.fail('request.invalid'); end if;
  select k into v_key from jsonb_object_keys(p_patch) k where k <> all (private.settings_keys()) limit 1;
  if found then perform private.fail('settings.invalid', jsonb_build_object('field', v_key)); end if;

  select * into v_row from public.settings s where s.channel_id = p_channel;
  v_was := v_row.require_riot_id;
  begin
    v_row := jsonb_populate_record(v_row, p_patch);
    update public.settings s set
      join_command = v_row.join_command, leave_command = v_row.leave_command,
      position_command = v_row.position_command, perk_command = v_row.perk_command,
      away_command = v_row.away_command, team_size = v_row.team_size,
      riot_enabled = v_row.riot_enabled, require_riot_id = v_row.require_riot_id,
      riot_region = v_row.riot_region, fair_play = v_row.fair_play, draw_reveal = v_row.draw_reveal,
      stream_locale = v_row.stream_locale, watch_enabled = v_row.watch_enabled,
      watch_sections = v_row.watch_sections, chat_replies = v_row.chat_replies,
      perk_enabled = v_row.perk_enabled, perk_uses = v_row.perk_uses,
      perk_window_days = v_row.perk_window_days, perk_badges = v_row.perk_badges,
      labels = v_row.labels, clear_on_offline = v_row.clear_on_offline, after_game = v_row.after_game,
      games_retention_days = v_row.games_retention_days, updated_at = now()
    where s.channel_id = p_channel
    returning jsonb_build_array(to_jsonb(s) || '{"_t":"settings"}'::jsonb) into v_rows;
  exception
    when check_violation then
      get stacked diagnostics v_c = constraint_name;
      if v_c = 'settings_labels_check' then perform private.fail('settings.label_invalid'); end if;
      perform private.fail('settings.invalid', jsonb_build_object('field',
        case v_c when 'settings_check' then 'commands' else regexp_replace(v_c, '^settings_(.*)_check$', '\1') end));
    when not_null_violation then
      get stacked diagnostics v_c = column_name;
      perform private.fail('settings.invalid', jsonb_build_object('field', v_c));
    when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range
         or invalid_parameter_value or string_data_right_truncation then
      perform private.fail('settings.invalid', jsonb_build_object('field', null));
  end;

  -- Riot IDs are the master switch (owner, 2026-09-28): turned on, a player without one cannot
  -- stay; turned off, nobody keeps one, and the Kick name is the name. The dashboard asks first;
  -- there is no Undo (settings are not in the undo stack).
  if v_row.require_riot_id and not v_was then
    update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and p.riot_id is null;
    get diagnostics v_n = row_count;
  elsif v_was and not v_row.require_riot_id then
    update public.players p set riot_id = null, puuid = null, changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and (p.riot_id is not null or p.puuid is not null);
    get diagnostics v_n = row_count;
  end if;

  return private.commit(p_channel, b.next_v, b.actor, 'update_settings', null,
    jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k))
      || case when v_n > 0 then jsonb_build_object(case when v_was then 'riot_cleared' else 'riot_removed' end, v_n) else '{}'::jsonb end,
    null, p_request_id, v_rows);
end $$;

create or replace function private.retention() returns void
language plpgsql set search_path = '' as $$
declare
  v_ch    uuid;
  v_ids   uuid[];
  v_names text[];
begin
  delete from public.players where deleted_at < now() - interval '10 minutes';
  update public.activity set undo = null where undo is not null and created_at < now() - interval '10 minutes';
  delete from public.draws d
  where d.created_at < now() - interval '24 hours'
    and d.id is distinct from (select x.id from public.draws x
                               where x.channel_id = d.channel_id and x.undone_at is null
                               order by x.created_at desc limit 1);
  delete from public.activity where created_at < now() - interval '30 days';
  delete from public.webhook_events where received_at < now() - interval '1 hour';
  delete from public.perk_uses u using public.settings s
  where s.channel_id = u.channel_id and u.used_at < now() - make_interval(days => s.perk_window_days + 1);
  delete from public.channel_members
  where source = 'badge' and not blocked and coalesce(last_seen_at, created_at) < now() - interval '30 days';
  delete from public.riot_cache where fetched_at < now() - interval '7 days';
  -- 0027: a removed game once its undo window has passed; a game older than the channel's
  -- retention, recounting the records of the people in it.
  delete from public.games where removed_at < now() - interval '10 minutes';
  for v_ch, v_ids in
    select g.channel_id, array_agg(g.id) from public.games g
    join public.settings s on s.channel_id = g.channel_id
    where g.ended_at < now() - make_interval(days => s.games_retention_days)
    group by g.channel_id
  loop
    select array_agg(distinct gp.name) into v_names from public.game_players gp where gp.game_id = any(v_ids);
    delete from public.games g where g.id = any(v_ids);
    perform private.recount(v_ch, coalesce(v_names, '{}'));
  end loop;
end $$;

-- A team as it stands, for the game's snapshot: each player with their rank at this moment.
create function private.game_roster(p_channel uuid, p_team smallint) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'riot_id', p.riot_id,
      'locked', p.locked,
      'rank', (select jsonb_build_object('tier', r.tier, 'division', r.division, 'lp', r.league_points)
               from public.riot_cache r where r.puuid = p.puuid))
    order by p.sort_key, p.joined_at), '[]'::jsonb)
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = p_team
$$;
revoke execute on function private.game_roster(uuid, smallint) from public, anon, authenticated;

-- Victory (D27). p_base is the latest game the pressing client knew: a different one means
-- someone recorded first (two moderators, a double press), so nothing is recorded and that game
-- comes back, as draw_stale does for draws. Both teams must have players. The after-game action
-- runs in the same transaction: *everyone back* and *losers back* in this write; *shuffle* and
-- the two draws by calling shuffle_teams / draw_teams after it, a second write whose activity
-- the game's names (then), so one Undo takes both back. A draw that cannot run (too few players)
-- leaves the teams as they are and the game stands.
create function public.record_game(p_channel uuid, p_winner smallint, p_base uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b           record;
  s           public.settings;
  v_latest    public.games;
  v_game      public.games;
  v_draw      public.draws;
  v_before    jsonb;
  v_mod       jsonb;
  v_mod_ids   uuid[];
  v_mod_names text[];
  v_names     text[];
  v_ids       uuid[];
  v_rows      jsonb;
  v_r1        jsonb;
  v_r2        jsonb;
  v_act       bigint;
  v_then      bigint;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_winner is null or p_winner not in (1, 2) then perform private.fail('request.invalid'); end if;

  select * into v_latest from public.games g
  where g.channel_id = p_channel and g.removed_at is null order by g.n desc limit 1;
  if v_latest.id is distinct from p_base then
    return (select jsonb_build_object('v', c.version, 'kind', 'game_stale',
      'rows', case when v_latest.id is null then '[]'::jsonb else jsonb_build_array(private.game_json(v_latest)) end,
      'actor', b.actor) from public.channels c where c.id = p_channel);
  end if;
  if not exists (select 1 from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.team = 1)
     or not exists (select 1 from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.team = 2) then
    perform private.fail('game.team_empty');
  end if;
  select * into s from public.settings x where x.channel_id = p_channel;
  select d.* into v_draw from public.draws d
  where d.channel_id = p_channel and d.undone_at is null and d.kind = 'teams' order by d.created_at desc limit 1;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb), array_agg(p.id) filter (where p.status = 'playing')
  into v_before, v_ids
  from public.players p where p.channel_id = p_channel and p.deleted_at is null;

  -- Started with the draw that made the teams, or when the previous game ended if later.
  insert into public.games (channel_id, n, draw_id, winner, teams, team_size, started_at, recorded_by, request_id)
  values (p_channel, coalesce((select max(g.n) from public.games g where g.channel_id = p_channel), 0) + 1,
    v_draw.id, p_winner,
    jsonb_build_array(private.game_roster(p_channel, 1::smallint), private.game_roster(p_channel, 2::smallint)),
    s.team_size, greatest(v_draw.created_at, v_latest.ended_at), b.actor, coalesce(p_request_id, gen_random_uuid()))
  returning * into v_game;
  insert into public.game_players (game_id, channel_id, name, kick_username, riot_id, team, won)
  select v_game.id, p_channel, lower(p.kick_username), p.kick_username, p.riot_id, p.team, p.team = p_winner
  from public.players p where p.id = any(v_ids);
  select array_agg(gp.name) into v_names from public.game_players gp where gp.game_id = v_game.id;

  if s.after_game in ('queue', 'losers') then
    update public.players p set status = 'waiting', team = null, locked = false,
      changed_v = b.next_v, changed_by = b.actor
    where p.id = any(v_ids) and (s.after_game = 'queue' or p.team <> p_winner);
  end if;

  -- The game serves one game of every game-count punishment; settle frees whoever is done.
  select jsonb_agg(to_jsonb(m)), array_agg(m.id), array_agg(m.kick_username)
  into v_mod, v_mod_ids, v_mod_names
  from public.moderation m
  where m.channel_id = p_channel and m.kind = 'punish' and m.revoked_at is null and m.games_left > 0;
  update public.moderation m set games_left = m.games_left - 1 where m.id = any(v_mod_ids);
  perform private.settle(p_channel, b.next_v, b.actor);

  v_rows := jsonb_build_array(private.game_json(v_game)) || private.recount(p_channel, v_names)
    || jsonb_build_array(private.score(p_channel));
  if v_mod_ids is not null then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod_ids, v_mod_names);
  end if;
  v_r1 := private.commit(p_channel, b.next_v, b.actor, 'record_game', null,
    jsonb_build_object('game', v_game.id, 'n', v_game.n, 'winner', p_winner),
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_before) e
                  join public.players p on p.id = (e ->> 'id')::uuid where p.changed_v = b.next_v),
      'moderation', coalesce(v_mod, '[]'::jsonb),
      'game', v_game.id),
    p_request_id, v_rows);

  if s.after_game not in ('shuffle', 'draw_all', 'draw_queue') then return v_r1; end if;
  begin
    if s.after_game = 'draw_queue' then
      perform set_config('queue.draw_exclude', array_to_string(v_ids, ','), true);
    end if;
    if s.after_game = 'shuffle' then
      v_r2 := public.shuffle_teams(p_channel, (private.latest_draw(p_channel)).id, gen_random_uuid());
    else
      v_r2 := public.draw_teams(p_channel, (private.latest_draw(p_channel)).id, false, gen_random_uuid());
    end if;
    perform set_config('queue.draw_exclude', '', true);
  exception when sqlstate 'P0001' then
    v_r2 := null;
  end;
  if v_r2 is null or v_r2 ->> 'kind' not in ('shuffle_teams', 'draw_teams') then return v_r1; end if;

  select (e ->> 'id')::bigint into v_act from jsonb_array_elements(v_r1 -> 'rows') e where e ->> '_t' = 'activity';
  select (e ->> 'id')::bigint into v_then from jsonb_array_elements(v_r2 -> 'rows') e where e ->> '_t' = 'activity';
  update public.activity x set undo = x.undo || jsonb_build_object('then', v_then) where x.id = v_act;
  return jsonb_build_object('v', v_r2 -> 'v', 'kind', 'record_game', 'rows', (v_r1 -> 'rows') || (v_r2 -> 'rows'),
    'actor', b.actor);
end $$;

-- Remove this game (a game's ⋯, owner or moderator), undoable: records are recounted without it.
create function public.remove_game(p_channel uuid, p_game uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b       record;
  v_game  public.games;
  v_names text[];
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  update public.games g set removed_at = now()
  where g.id = p_game and g.channel_id = p_channel and g.removed_at is null
  returning * into v_game;
  if not found then perform private.fail('game.not_found'); end if;
  select array_agg(gp.name) into v_names from public.game_players gp where gp.game_id = p_game;
  return private.commit(p_channel, b.next_v, b.actor, 'remove_game', null,
    jsonb_build_object('game', v_game.id, 'n', v_game.n, 'winner', v_game.winner),
    jsonb_build_object('games', jsonb_build_array(v_game.id)), p_request_id,
    jsonb_build_array(private.game_json(v_game)) || private.recount(p_channel, coalesce(v_names, '{}'))
      || jsonb_build_array(private.score(p_channel)));
end $$;

-- Clear games (streamer only), undoable. The dashboard is told to reload its list rather than
-- sent every game.
create function public.clear_games(p_channel uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b       record;
  v_ids   uuid[];
  v_names text[];
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  with u as (
    update public.games g set removed_at = now()
    where g.channel_id = p_channel and g.removed_at is null returning g.id)
  select array_agg(u.id) into v_ids from u;
  if v_ids is null then perform private.fail('game.not_found'); end if;
  select array_agg(distinct gp.name) into v_names from public.game_players gp where gp.game_id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_games', null,
    jsonb_build_object('n', cardinality(v_ids)),
    jsonb_build_object('games', to_jsonb(v_ids)), p_request_id,
    jsonb_build_array(jsonb_build_object('_t', 'games_reload'))
      || private.recount(p_channel, coalesce(v_names, '{}')) || jsonb_build_array(private.score(p_channel)));
end $$;

-- Remove from all history (streamer only, D28), undoable: the name's rows and record go, and in
-- every game it played its place in the roster reads as a removed player.
create function public.forget_player(p_channel uuid, p_name text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b       record;
  v_name  text := lower(btrim(p_name));
  v_ids   uuid[];
  v_teams jsonb;
  v_gp    jsonb;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select array_agg(g.id), jsonb_agg(jsonb_build_object('id', g.id, 'teams', g.teams)) into v_ids, v_teams
  from public.games g
  where g.channel_id = p_channel
    and g.id in (select gp.game_id from public.game_players gp where gp.channel_id = p_channel and gp.name = v_name);
  if v_ids is null then perform private.fail('game.not_found'); end if;
  select jsonb_agg(to_jsonb(gp)) into v_gp
  from public.game_players gp where gp.channel_id = p_channel and gp.name = v_name;
  delete from public.game_players gp where gp.channel_id = p_channel and gp.name = v_name;
  update public.games g set teams = (
    select jsonb_agg((
      select coalesce(jsonb_agg(case when lower(e ->> 'kick_username') = v_name
                                     then jsonb_build_object('removed', true) else e end order by o), '[]'::jsonb)
      from jsonb_array_elements(t) with ordinality x (e, o)) order by tn)
    from jsonb_array_elements(g.teams) with ordinality y (t, tn))
  where g.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'forget_player', v_name,
    jsonb_build_object('games', cardinality(v_ids)),
    jsonb_build_object('game_teams', v_teams, 'game_players', v_gp), p_request_id,
    case when cardinality(v_ids) > 20 then jsonb_build_array(jsonb_build_object('_t', 'games_reload'))
         else (select jsonb_agg(private.game_json(g)) from public.games g where g.id = any(v_ids)) end
      || private.recount(p_channel, array[v_name]));
end $$;

revoke execute on function public.record_game(uuid, smallint, uuid, uuid) from public, anon;
revoke execute on function public.remove_game(uuid, uuid, uuid) from public, anon;
revoke execute on function public.clear_games(uuid, uuid) from public, anon;
revoke execute on function public.forget_player(uuid, text, uuid) from public, anon;
grant execute on function public.record_game(uuid, smallint, uuid, uuid) to authenticated;
grant execute on function public.remove_game(uuid, uuid, uuid) to authenticated;
grant execute on function public.clear_games(uuid, uuid) to authenticated;
grant execute on function public.forget_player(uuid, text, uuid) to authenticated;
