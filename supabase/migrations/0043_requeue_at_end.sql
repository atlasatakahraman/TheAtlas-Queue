-- Players taken off a team go to the end of the queue (spec 2026-10-18 § 1, R1–R5).
-- No path off a team rewrote players.sort_key, so a returned player got their old place back;
-- only private.settle (punished from a team, 0020) already moved them to the end.
--   R1  every return lands at the end: move_player, clear_teams, a fresh draw_teams, record_game
--   R2  players returned together keep their relative order (old sort_key, then joined_at)
--   R3  playing → away also gets the end key; away ↔ waiting keeps it
--   R4  an explicit p_key (a drag onto a place) still wins
--   R5  chat !position counts in the dashboard's order, (sort_key, joined_at)
-- Bodies are the live ones (pg_get_functiondef); only the lines named above change. Undo already
-- restores sort_key from every snapshot, so it needs no change.

-- Steps of 1 ms keep a batch of ten inside 10 ms of now; a join inside that window may interleave,
-- which is harmless. Called right after the update that returned them.
create function private.requeue(p_ids uuid[]) returns void
language sql set search_path = '' as $$  -- runs inside the definer RPCs, like private.snapshot
  update public.players p
  set sort_key = extract(epoch from clock_timestamp()) + o.rn * 0.001
  from (select x.id, row_number() over (order by x.sort_key, x.joined_at) rn
        from public.players x where x.id = any(p_ids)) o
  where p.id = o.id
$$;
revoke execute on function private.requeue(uuid[]) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.move_player(p_channel uuid, p_player uuid, p_status text, p_team smallint, p_request_id uuid, p_key double precision DEFAULT NULL::double precision, p_slot smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b      record;
  p      public.players;
  v_size smallint;
  v_free smallint;
  v_push uuid[] := '{}';
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_status not in ('waiting', 'playing', 'away')
     or (p_status = 'playing') <> (p_team is not null)
     or (p_team is not null and p_team not in (1, 2))
     or (p_slot is not null and p_status <> 'playing') then
    perform private.fail('request.invalid');
  end if;
  perform private.check_key(p_key);
  select * into p from public.players x where x.id = p_player and x.channel_id = p_channel and x.deleted_at is null;
  if not found then perform private.fail('request.invalid'); end if;
  select s.team_size into v_size from public.settings s where s.channel_id = p_channel;
  if p_slot is not null and p_slot not between 1 and v_size then perform private.fail('request.invalid'); end if;

  if p_status = 'playing' and p.team is distinct from p_team
     and (select count(*) from public.players x
          where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
         >= v_size then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  -- The slot is taken by someone else: the nearest empty slot below it, else above it, and the
  -- players between that and the slot, who each move one toward it.
  if p_slot is not null and exists (select 1 from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.team_slot = p_slot and x.id <> p_player) then
    select min(g) into v_free from generate_series(p_slot + 1, v_size) g
    where not exists (select 1 from public.players x
                      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing'
                        and x.team = p_team and x.team_slot = g and x.id <> p_player);
    if v_free is not null then
      select coalesce(array_agg(x.id), '{}') into v_push from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.id <> p_player and x.team_slot >= p_slot and x.team_slot < v_free;
    else
      select max(g) into v_free from generate_series(1, p_slot - 1) g
      where not exists (select 1 from public.players x
                        where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing'
                          and x.team = p_team and x.team_slot = g and x.id <> p_player);
      if v_free is null then perform private.fail('draw.team_full', jsonb_build_object('team', p_team)); end if;
      select coalesce(array_agg(x.id), '{}') into v_push from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.id <> p_player and x.team_slot > v_free and x.team_slot <= p_slot;
    end if;
  end if;

  v_undo := private.snapshot(p_channel, array[p_player] || v_push);
  -- x.status here is the row before the update: off a team (R1, R3) means the end of the queue.
  update public.players x set status = p_status, team = p_team,
    sort_key = coalesce(p_key, case when x.status = 'playing' and p_status <> 'playing'
                                    then extract(epoch from clock_timestamp()) else x.sort_key end),
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_player;
  if cardinality(v_push) > 0 then
    update public.players x
    set team_slot = x.team_slot + case when v_free > p_slot then 1 else -1 end, changed_v = b.next_v, changed_by = b.actor
    where x.id = any(v_push);
  end if;
  if p_slot is not null then
    update public.players x set team_slot = p_slot where x.id = p_player;
  end if;
  return private.commit(p_channel, b.next_v, b.actor, 'move_player', p.kick_username,
    jsonb_build_object('status', p_status, 'team', p_team), jsonb_build_object('players', v_undo), p_request_id);
end $function$;

CREATE OR REPLACE FUNCTION public.clear_teams(p_channel uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.requeue(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_teams', null,
    jsonb_build_object('n', cardinality(v_ids)), jsonb_build_object('players', v_before), p_request_id);
end $function$;

CREATE OR REPLACE FUNCTION public.draw_teams(p_channel uuid, p_base uuid, p_reroll boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_back      uuid[];
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

  with u as (
    update public.players p set status = 'waiting', team = null,
      changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
    returning p.id)
  select array_agg(u.id) into v_back from u;
  -- Before the pool is drawn; the pool is ordered by games_played and random bytes, not sort_key.
  perform private.requeue(v_back);

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
  v_back      uuid[];
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
    with u as (
      update public.players p set status = 'waiting', team = null,
        changed_v = b.next_v, changed_by = b.actor
      where p.id = any(v_ids) and (s.after_game = 'queue' or p.team <> p_winner)
      returning p.id)
    select array_agg(u.id) into v_back from u;
    perform private.requeue(v_back);
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

CREATE OR REPLACE FUNCTION public.ingest_chat(p_broadcaster bigint, p_message_id text, p_command text, p_riot_id text, p_sender_id bigint, p_sender_name text, p_badges text[], p_live_gate text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l        record;
  s        public.settings;
  p        public.players;
  v_reason text;
  v_puuid  text;
  v_n      integer;
  v_ev     jsonb;
  v_chan   jsonb;
  v_staff  boolean := p_sender_id = p_broadcaster or 'moderator' = any(coalesce(p_badges, '{}'));
begin
  if p_live_gate is not null and p_live_gate not in ('check', 'confirmed') then perform private.fail('request.invalid'); end if;
  -- Only while live, first pass: an offline join returns before any lock or write, so the webhook
  -- can ask Kick whether a live event was missed. One indexed read; skipped for every other case.
  if p_live_gate = 'check' and p_command = 'join' and not coalesce(v_staff, false) and exists (
       select 1 from public.channels c join public.settings x on x.channel_id = c.id
       where c.kick_channel_id = p_broadcaster and c.live_since is null and x.join_live_only) then
    return jsonb_build_object('result', 'offline');
  end if;
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  if p_command not in ('join', 'leave', 'position', 'perk', 'away') or p_sender_id is null
     or p_sender_name !~ '^\S{1,40}$' or length(p_message_id) not between 1 and 128 then
    perform private.fail('request.invalid');
  end if;
  insert into public.webhook_events (message_id) values (p_message_id) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;

  select * into s from public.settings x where x.channel_id = l.channel_id;
  update public.channels c set last_command_at = now() where c.id = l.channel_id;
  v_chan := jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', l.channel_id, 'last_command_at', now()));
  select * into p from public.players x
  where x.channel_id = l.channel_id and x.deleted_at is null
    and (x.kick_user_id = p_sender_id or lower(x.kick_username) = lower(p_sender_name))
  order by x.kick_user_id = p_sender_id desc nulls last
  limit 1;

  if p_command = 'join' then
    -- One join per user per 10 s: spam is dropped, not written to the feed.
    if exists (select 1 from public.activity a
               where a.channel_id = l.channel_id and a.created_at > now() - interval '10 seconds'
                 and a.action in ('chat_join', 'chat_rejected')
                 and a.payload ->> 'kick_user_id' = p_sender_id::text) then
      return jsonb_build_object('result', 'ignored', 'reason', 'queue.cooldown');
    end if;
    begin
      -- Second pass (Kick confirmed offline or did not answer): re-checked under the channel lock,
      -- so a live event committed meanwhile wins.
      if p_live_gate = 'confirmed' and s.join_live_only and not coalesce(v_staff, false)
         and (select c.live_since from public.channels c where c.id = l.channel_id) is null then
        perform private.fail('queue.offline');
      end if;
      perform private.join_check(l.channel_id, p_sender_name, p_sender_id, p_riot_id);
      perform private.join_rules(l.channel_id, s, p_sender_name, p_badges, coalesce(v_staff, false));
    exception when sqlstate 'P0001' then
      v_reason := sqlerrm;
    end;
    if v_reason is not null then
      v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_rejected', p_sender_name,
        jsonb_build_object('reason', v_reason, 'kick_user_id', p_sender_id, 'riot_id', p_riot_id), null, null, v_chan);
      return jsonb_build_object('result', 'rejected', 'reason', v_reason, 'v', v_ev -> 'v');
    end if;
    if p_riot_id is not null then
      select r.puuid into v_puuid from public.riot_cache r
      where lower(r.game_name) = lower(split_part(p_riot_id, '#', 1)) and lower(r.tag_line) = lower(split_part(p_riot_id, '#', 2))
        and r.fetched_at > now() - interval '6 hours'
      order by r.fetched_at desc limit 1;
    end if;
    insert into public.players (channel_id, kick_user_id, kick_username, riot_id, puuid, is_subscriber, badges,
      source, changed_v, changed_by)
    values (l.channel_id, p_sender_id, p_sender_name, p_riot_id, v_puuid, coalesce('subscriber' = any(p_badges), false),
      coalesce(p_badges[1:16], '{}'), 'chat', l.next_v, null)
    returning * into p;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_join', p_sender_name,
      jsonb_build_object('kick_user_id', p_sender_id, 'riot_id', p_riot_id), null, null, v_chan);
    return jsonb_build_object('result', 'joined', 'player', p.id, 'v', v_ev -> 'v',
      'rank_needed', s.riot_enabled and p_riot_id is not null and v_puuid is null);
  end if;

  if p_command = 'leave' then
    if p.id is null then return jsonb_build_object('result', 'none'); end if;
    update public.players x set deleted_at = now(), changed_v = l.next_v, changed_by = null where x.id = p.id;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_leave', p.kick_username,
      jsonb_build_object('kick_user_id', p_sender_id), null, null, v_chan);
    return jsonb_build_object('result', 'left', 'v', v_ev -> 'v');
  end if;

  if p_command = 'away' then
    if p.id is null or p.status in ('playing', 'punished') then return jsonb_build_object('result', 'none'); end if;
    update public.players x set status = case x.status when 'away' then 'waiting' else 'away' end,
      changed_v = l.next_v, changed_by = null
    where x.id = p.id returning * into p;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_away', p.kick_username,
      jsonb_build_object('kick_user_id', p_sender_id, 'status', p.status), null, null, v_chan);
    return jsonb_build_object('result', 'away', 'status', p.status, 'v', v_ev -> 'v');
  end if;

  if p_command = 'position' then
    if p.id is null or p.status <> 'waiting' then return jsonb_build_object('result', 'position', 'position', null); end if;
    select count(*) into v_n from public.players x
    where x.channel_id = l.channel_id and x.deleted_at is null and x.status = 'waiting' and (x.sort_key, x.joined_at) <= (p.sort_key, p.joined_at);
    return jsonb_build_object('result', 'position', 'position', v_n);
  end if;

  -- perk: uses left in the rolling window, only for a sender with one of the perk badges (the
  -- same test as private.apply_perk); anyone else is told who the perk is for.
  if not coalesce(p_badges, '{}') && s.perk_badges then
    return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', false);
  end if;
  select count(*) into v_n from public.perk_uses u
  where u.channel_id = l.channel_id and u.kick_user_id = p_sender_id and u.refunded_at is null
    and u.used_at > now() - make_interval(days => s.perk_window_days);
  return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', true, 'left', greatest(s.perk_uses - v_n, 0));
end $function$;

