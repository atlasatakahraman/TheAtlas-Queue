-- Protection redesign (owner, 2026-10-06; spec 2026-10-06-queue-protection-redesign, P1–P13).
-- Protection leaves Draw Teams: no lock on a draw, a reroll or a shuffle; players.locked goes.
-- It lives in pick_players now (part 2 below). Supersedes 0039–0041's draw path and ADRs
-- 0001/0081.

drop function public.remove_protection(uuid, uuid, uuid);
drop function private.perk_protected(uuid, uuid[]);
drop function private.perk_charge(uuid, uuid);
drop function private.apply_perk(uuid, uuid[], bigint, text);

-- The kept-on-team chat line is sent once per pick, whoever asks first (spec § 4).
alter table public.draws add column announced_at timestamptz;

create or replace function private.rosters(p_channel uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('teams', jsonb_build_array(
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username) order by p.joined_at), '[]'::jsonb)
     from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = 1),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username) order by p.joined_at), '[]'::jsonb)
     from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = 2)))
$$;

create or replace function private.game_roster(p_channel uuid, p_team smallint) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'riot_id', p.riot_id,
      'rank', (select jsonb_build_object('tier', r.tier, 'division', r.division, 'lp', r.league_points)
               from public.riot_cache r where r.puuid = p.puuid))
    order by p.team_slot nulls last, p.sort_key, p.joined_at), '[]'::jsonb)
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = p_team
$$;

create or replace function public.clear_teams(p_channel uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  v_ids    uuid[];
  v_before jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';
  if cardinality(v_ids) = 0 then perform private.fail('teams.empty'); end if;

  v_before := private.snapshot(p_channel, v_ids);
  update public.players p set status = 'waiting', team = null,
    changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_teams', null,
    jsonb_build_object('n', cardinality(v_ids)), jsonb_build_object('players', v_before), p_request_id);
end $$;

-- Reroll and Shuffle (0040's re-split of the same players), with nobody fixed in place: protection
-- no longer exists in team draws (P1).
create or replace function private.reshuffle(p_channel uuid, p_from uuid, p_next_v bigint, p_actor text, p_request_id uuid, p_kind text)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  s        public.settings;
  v_draw   public.draws;
  v_before jsonb;
  v_free   uuid[];
  v_need1  integer;
  v_team1  uuid[];
begin
  select * into s from public.settings x where x.channel_id = p_channel;
  select coalesce(array_agg(p.id order by extensions.gen_random_bytes(8)), '{}') into v_free
  from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';
  if cardinality(v_free) < 2 then perform private.fail('draw.not_enough'); end if;
  v_need1 := ceil(cardinality(v_free) / 2.0)::integer;

  v_team1 := private.split_teams(p_channel, v_free, v_need1, '{}', '{}');
  v_before := private.snapshot(p_channel, v_free);
  update public.players p set team = case when p.id = any(v_team1) then 1 else 2 end,
    changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_free);

  insert into public.draws (channel_id, kind, n, result, rerolled_from, request_id, created_by)
  values (p_channel, 'teams', s.team_size, private.rosters(p_channel),
    p_from, coalesce(p_request_id, gen_random_uuid()), p_actor)
  returning * into v_draw;

  return private.commit(p_channel, p_next_v, p_actor, p_kind, null,
    jsonb_build_object('draw', v_draw.id),
    jsonb_build_object('players', v_before, 'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;

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
  v_rows      jsonb;
  v_ids1      uuid[];
  v_ids2      uuid[];
  v_team1     uuid[];
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
    -- Nothing to reroll (no draw, or nobody left in the teams): a fresh draw.
    p_reroll := found and exists (select 1 from public.players p
      where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing');
  end if;
  if p_reroll then
    return private.reshuffle(p_channel, v_prior.id, b.next_v, b.actor, p_request_id, 'reroll');
  end if;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_before
  from public.players p where p.channel_id = p_channel and p.deleted_at is null;

  update public.players p set status = 'waiting', team = null,
    changed_v = b.next_v, changed_by = b.actor
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';

  select count(*) filter (where p.team = 1), count(*) filter (where p.team = 2),
         coalesce(array_agg(p.id) filter (where p.team = 1), '{}'), coalesce(array_agg(p.id) filter (where p.team = 2), '{}')
  into v_fixed1, v_fixed2, v_ids1, v_ids2
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
  v_team1 := private.split_teams(p_channel, v_sel, v_need1, v_ids1, v_ids2);
  update public.players p set status = 'playing',
    team = case when p.id = any(v_team1) then 1 else 2 end,
    changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_sel);

  insert into public.draws (channel_id, kind, n, result, rerolled_from, request_id, created_by)
  values (p_channel, 'teams', s.team_size, private.rosters(p_channel),
    null, coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  v_rows := jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb);
  if v_mod_ids is not null then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod_ids, v_mod_names);
  end if;
  return private.commit(p_channel, b.next_v, b.actor,
    'draw_teams', null,
    jsonb_build_object('draw', v_draw.id),
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_before) e
                  join public.players p on p.id = (e ->> 'id')::uuid where p.changed_v = b.next_v),
      'moderation', coalesce(v_mod, '[]'::jsonb),
      'draw', v_draw.id),
    p_request_id, v_rows);
end $$;

-- The five below are the live definitions (2026-10-06) with only their locked reads removed;
-- watch_snapshot_base also carries the reveal style for /watch's Picked dialog (P13).

CREATE OR REPLACE FUNCTION private.settle(p_channel uuid, p_next_v bigint, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ban    uuid[];
  v_pun    uuid[];
  v_free   uuid[];
  v_before jsonb;
begin
  select coalesce(array_agg(q.id) filter (where q.s = 'ban'), '{}'),
         coalesce(array_agg(q.id) filter (where q.s = 'punish'), '{}'),
         coalesce(array_agg(q.id) filter (where q.s is null), '{}')
  into v_ban, v_pun, v_free
  from (select p.id, x.s from public.players p
        cross join lateral (select private.sanction(p_channel, p.kick_username, p.kick_user_id) s) x
        where p.channel_id = p_channel and p.deleted_at is null
          and (x.s = 'ban' or (x.s is not distinct from 'punish') <> (p.status = 'punished'))) q;
  if cardinality(v_ban) + cardinality(v_pun) + cardinality(v_free) = 0 then return '[]'::jsonb; end if;

  v_before := private.snapshot(p_channel, v_ban || v_pun || v_free);
  perform set_config('queue.settling', 'on', true);
  update public.players p set deleted_at = now(), changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_ban);
  update public.players p set status = 'punished', team = null,
    punished_from_team = (p.status = 'playing'), changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_pun);
  update public.players p set status = 'waiting',
    sort_key = case when p.punished_from_team then extract(epoch from clock_timestamp()) else p.sort_key end,
    punished_from_team = false, changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_free);
  perform set_config('queue.settling', 'off', true);
  return v_before;
end $function$;

CREATE OR REPLACE FUNCTION public.record_game(p_channel uuid, p_winner smallint, p_base uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    update public.players p set status = 'waiting', team = null,
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
end $function$;

CREATE OR REPLACE FUNCTION public.overlay_snapshot(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.overlays;
  c public.channels;
  s public.settings;
  v_on text[];
  v_since timestamptz;
begin
  if p_key !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into o from public.overlays x where x.key = p_key and x.deleted_at is null;
  if not found then return null; end if;
  select * into c from public.channels where id = o.channel_id;
  select * into s from public.settings where channel_id = c.id;
  select array_agg(w ->> 'type') into v_on from jsonb_array_elements(o.config -> 'widgets') w where (w ->> 'on')::boolean;
  v_on := coalesce(v_on, '{}');
  v_since := case when o.config ->> 'board_period' = 'stream' then private.session_start(c.id) end;

  return jsonb_build_object(
    'v', c.version,
    'slug', c.slug,
    'config', o.config,
    'lang', coalesce(o.config ->> 'lang', s.stream_locale),
    'labels', s.labels,
    'team_size', s.team_size,
    'teams', case when 'teams' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'team', p.team,
                'team_slot', p.team_slot) order by p.team, p.team_slot nulls last, p.sort_key), '[]'::jsonb)
       from public.players p where p.channel_id = c.id and p.deleted_at is null and p.status = 'playing') end,
    'queue', case when 'queue' = any(v_on) then jsonb_build_object(
      'total', (select count(*) from public.players p where p.channel_id = c.id and p.deleted_at is null and p.status = 'waiting'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kick_username', x.kick_username) order by x.sort_key, x.joined_at), '[]'::jsonb)
               from (select p.id, p.kick_username, p.sort_key, p.joined_at from public.players p
                     where p.channel_id = c.id and p.deleted_at is null and p.status = 'waiting'
                     order by p.sort_key, p.joined_at limit (o.config ->> 'queue_rows')::int) x)) end,
    'score', case when 'score' = any(v_on) then private.score(c.id) - '_t' - 'since' end,
    'last', case when 'last' = any(v_on) then
      (select jsonb_build_object('n', g.n, 'winner', g.winner, 'ended_at', g.ended_at,
         'teams', (select jsonb_agg((select coalesce(jsonb_agg(e -> 'kick_username'), '[]'::jsonb)
                                     from jsonb_array_elements(t) e where not e ? 'removed') order by i)
                   from jsonb_array_elements(g.teams) with ordinality x(t, i)))
       from public.games g where g.channel_id = c.id and g.removed_at is null order by g.n desc limit 1) end,
    'wins', case when 'wins' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', private.shown_name(c.id, r.name), 'wins', r.w, 'games', r.n)
                order by r.w desc, r.w::numeric / r.n desc, r.n, r.name), '[]'::jsonb)
       from (select gp.name, count(*) filter (where gp.won) w, count(*) n
             from public.game_players gp join public.games g on g.id = gp.game_id
             where gp.channel_id = c.id and g.removed_at is null and (v_since is null or g.ended_at >= v_since)
             group by gp.name
             having count(*) filter (where gp.won) > 0 and count(*) >= greatest((o.config ->> 'min_games')::int, 1)
             order by count(*) filter (where gp.won) desc, (count(*) filter (where gp.won))::numeric / count(*) desc, count(*), gp.name
             limit (o.config ->> 'board_rows')::int) r) end,
    -- Only the most respected (D29): the top of the board, never its bottom.
    'respect', case when 'respect' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', private.shown_name(c.id, r.name), 'respect', r.respect, 'games', r.n)
                order by r.respect desc, r.n desc, r.name), '[]'::jsonb)
       from (select x.name, x.n, private.respect(c.id, x.name) respect
             from (select gp.name, count(*) n from public.game_players gp join public.games g on g.id = gp.game_id
                   where gp.channel_id = c.id and g.removed_at is null and (v_since is null or g.ended_at >= v_since)
                   group by gp.name having count(*) >= greatest((o.config ->> 'min_games')::int, 1)) x
             order by respect desc, x.n desc, x.name
             limit (o.config ->> 'board_rows')::int) r) end,
    'draw', case when 'reveal' = any(v_on) then
      (select jsonb_build_object('id', d.id, 'kind', d.kind, 'n', d.n, 'result', d.result, 'created_at', d.created_at)
       from public.draws d where d.channel_id = c.id and d.undone_at is null order by d.created_at desc limit 1) end
  );
end $function$;

CREATE OR REPLACE FUNCTION public.undo(p_channel uuid, p_activity bigint, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      status = r.status, team = r.team, deleted_at = r.deleted_at,
      kick_username = r.kick_username, riot_id = r.riot_id, puuid = r.puuid,
      games_played = r.games_played, sort_key = coalesce(r.sort_key, p.sort_key), team_slot = r.team_slot,
      changed_v = r.changed_v, changed_by = r.changed_by
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

  -- Overlay (0031): a deleted overlay comes back, key and all.
  if a.undo ? 'overlay' then
    update public.overlays o set deleted_at = null where o.id = (a.undo ->> 'overlay')::uuid and o.channel_id = p_channel;
  end if;

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $function$;

CREATE OR REPLACE FUNCTION private.watch_snapshot_base(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.channels;
  s public.settings;
  v_riot boolean;
begin
  select * into c from public.channels where slug = lower(p_slug);
  if not found then return null; end if;
  select * into s from public.settings where channel_id = c.id;
  if not coalesce(s.watch_enabled, false) then
    return jsonb_build_object('disabled', true, 'channel', jsonb_build_object('slug', c.slug, 'name', c.display_name),
      'labels', coalesce(s.labels, '{}'::jsonb));
  end if;
  v_riot := 'riot_ids' = any(s.watch_sections) and s.riot_enabled;

  return jsonb_build_object(
    'v', c.version,
    'channel', jsonb_build_object('slug', c.slug, 'name', c.display_name, 'live', c.live_since is not null),
    'labels', s.labels,
    'sections', to_jsonb(s.watch_sections),
    'team_size', s.team_size,
    'draw_reveal', s.draw_reveal,  -- the Picked dialog on /watch (P13)
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username,
                  'status', p.status, 'team', p.team, 'team_slot', p.team_slot, 'sort_key', p.sort_key,
                  'riot_id', case when v_riot then p.riot_id end,
                  'rank', case when v_riot then private.player_json(p) -> 'rank' end)
                order by p.sort_key, p.joined_at), '[]'::jsonb)
                from public.players p
                where p.channel_id = c.id and p.deleted_at is null and p.status in ('waiting', 'playing')),
    'draw', (select jsonb_build_object('id', d.id, 'kind', d.kind, 'n', d.n, 'result', d.result, 'created_at', d.created_at)
             from public.draws d where d.channel_id = c.id and d.undone_at is null order by d.created_at desc limit 1),
    'score', private.score(c.id) - '_t',
    'games', case when 'games' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('n', g.n, 'winner', g.winner, 'ended_at', g.ended_at,
         'teams', (select jsonb_agg((select coalesce(jsonb_agg(case when e ? 'removed' then e
                                                                    else jsonb_build_object('kick_username', e ->> 'kick_username',
                                                                           'riot_id', case when v_riot then e -> 'riot_id' end,
                                                                           'rank', case when v_riot then e -> 'rank' end) end), '[]'::jsonb)
                                     from jsonb_array_elements(t) e) order by i)
                   from jsonb_array_elements(g.teams) with ordinality x(t, i)))
         order by g.n desc), '[]'::jsonb)
       from (select * from public.games x where x.channel_id = c.id and x.removed_at is null order by x.n desc limit 10) g) end,
    -- All time (owner, 2026-09-28): top 10 by wins. game_players keeps lower-cased names, so the
    -- casing comes from the queue, else the latest game that names them.
    'board', case when 'games' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(
           (select p.kick_username from public.players p where p.channel_id = c.id and lower(p.kick_username) = r.name limit 1),
           (select e ->> 'kick_username' from public.games g, jsonb_array_elements(g.teams -> 0 || g.teams -> 1) e
            where g.channel_id = c.id and lower(e ->> 'kick_username') = r.name order by g.n desc limit 1),
           r.name), 'wins', r.wins, 'losses', r.losses) order by r.wins desc, r.losses, r.name), '[]'::jsonb)
       from (select * from public.player_records x where x.channel_id = c.id and x.wins > 0
             order by x.wins desc, x.losses, x.name limit 10) r) end,
    -- Names and kind only, never reasons, never who (spec § Security).
    'moderation', case when 'moderation' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('kick_username', m.kick_username, 'kind', m.kind) order by m.created_at desc), '[]'::jsonb)
       from public.moderation m
       where m.channel_id = c.id and m.revoked_at is null and (m.expires_at is null or m.expires_at > now())
         and (m.games_left is null or m.games_left > 0)) end
  );
end $function$;

-- draw_root's only callers were perk_charge and remove_protection, both dropped above.
drop function private.draw_root(uuid);
