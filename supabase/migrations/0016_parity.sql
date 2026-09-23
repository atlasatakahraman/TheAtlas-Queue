-- August parity (vault stages/2026-09-23-queue-rewrite-stage-4b.md): shuffle the standing teams
-- only, pick from waiting / teams / everyone, clear the teams, clear the moderation history, and
-- the Riot win rate and summoner level the August queue showed.

-- Riot: wins, losses and summoner level ride along with the rank.
alter table public.riot_cache add column wins integer, add column losses integer, add column level integer;

create or replace function private.player_json(p public.players) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(p) || jsonb_build_object('_t', 'players', 'rank',
    (select jsonb_build_object('tier', r.tier, 'division', r.division, 'lp', r.league_points, 'icon', r.icon,
                               'wins', r.wins, 'losses', r.losses, 'level', r.level)
     from public.riot_cache r where r.puuid = p.puuid))
$$;

drop function public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer);
create function public.set_riot_rank(p_channel uuid, p_riot_id text, p_puuid text, p_game_name text,
  p_tag_line text, p_tier text, p_division text, p_lp integer, p_icon integer,
  p_wins integer default null, p_losses integer default null, p_level integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  insert into public.riot_cache (puuid, game_name, tag_line, tier, division, league_points, icon, wins, losses, level, fetched_at)
  values (p_puuid, p_game_name, p_tag_line, p_tier, p_division, p_lp, p_icon, p_wins, p_losses, p_level, now())
  on conflict (puuid) do update set game_name = excluded.game_name, tag_line = excluded.tag_line,
    tier = excluded.tier, division = excluded.division, league_points = excluded.league_points,
    icon = excluded.icon, wins = excluded.wins, losses = excluded.losses, level = excluded.level,
    fetched_at = now();
  with r as (
    update public.players x set puuid = p_puuid
    where x.channel_id = p_channel and x.deleted_at is null and lower(x.riot_id) = lower(p_riot_id)
      and x.puuid is distinct from p_puuid
    returning x.*)
  select jsonb_agg(private.player_json(r::public.players)) into v_rows from r;
  if v_rows is not null then perform private.emit(p_channel, 'rank', v_rows, null); end if;
  return jsonb_build_object('players', coalesce(jsonb_array_length(v_rows), 0));
end $$;
revoke execute on function public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer, integer, integer, integer) to service_role;

-- The standing rosters as a teams draw result, locked players first.
create function private.rosters(p_channel uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('teams', jsonb_build_array(
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'locked', p.locked)
                               order by p.locked desc, p.joined_at), '[]'::jsonb)
     from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = 1),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'locked', p.locked)
                               order by p.locked desc, p.joined_at), '[]'::jsonb)
     from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = 2)))
$$;
revoke execute on function private.rosters(uuid) from public, anon, authenticated;

-- Shuffle the teams only (August "Sadece Takımlar"): the players already playing are split
-- again at random, as evenly as possible; protected players keep their team. Nobody new comes
-- in and no game is counted (the status does not change).
create function public.shuffle_teams(p_channel uuid, p_base uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  s        public.settings;
  v_latest public.draws;
  v_draw   public.draws;
  v_before jsonb;
  v_fixed1 integer;
  v_fixed2 integer;
  v_free   uuid[];
  v_total  integer;
  v_need1  integer;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  select * into s from public.settings x where x.channel_id = p_channel;

  select count(*) filter (where p.locked and p.team = 1), count(*) filter (where p.locked and p.team = 2),
         coalesce(array_agg(p.id order by extensions.gen_random_bytes(8)) filter (where not p.locked), '{}')
  into v_fixed1, v_fixed2, v_free
  from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';
  v_total := v_fixed1 + v_fixed2 + cardinality(v_free);
  if v_total < 2 or cardinality(v_free) = 0 then perform private.fail('draw.not_enough'); end if;
  v_need1 := least(greatest(ceil(v_total / 2.0)::integer - v_fixed1, 0), cardinality(v_free));

  v_before := private.snapshot(p_channel, v_free);
  update public.players p set team = case when p.id = any(v_free[1:v_need1]) then 1 else 2 end,
    changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_free);

  insert into public.draws (channel_id, kind, n, result, rerolled_from, request_id, created_by)
  values (p_channel, 'teams', s.team_size, private.rosters(p_channel),
    case when v_latest.kind = 'teams' then v_latest.id end, coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  return private.commit(p_channel, b.next_v, b.actor, 'shuffle_teams', null,
    jsonb_build_object('draw', v_draw.id),
    jsonb_build_object('players', v_before, 'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;

-- Pick N (1–10) without replacement, uniformly, from waiting, from the teams, or from both.
-- Replaces pick_from_waiting; everything else is as it was: statuses do not change, and a drawn
-- sub with uses left is protected.
create function public.pick_players(p_channel uuid, p_n integer, p_source text, p_base uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  v_latest public.draws;
  v_draw   public.draws;
  v_pick   uuid[];
  v_before jsonb;
  v_perk   uuid[];
  v_uses   uuid[];
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_n is null or p_n not between 1 and 10 or p_source is null or p_source not in ('waiting', 'teams', 'all') then
    perform private.fail('request.invalid');
  end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;

  select coalesce((array_agg(p.id order by extensions.gen_random_bytes(8)))[1:p_n], '{}') into v_pick
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null
    and p.status = any(case p_source when 'waiting' then array['waiting'] when 'teams' then array['playing']
                                     else array['waiting', 'playing'] end)
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null;
  if cardinality(v_pick) = 0 then perform private.fail('draw.not_enough'); end if;

  v_before := private.snapshot(p_channel, v_pick);
  v_perk := private.apply_perk(p_channel, v_pick, b.next_v, b.actor);

  insert into public.draws (channel_id, kind, n, result, request_id, created_by)
  values (p_channel, 'pick', cardinality(v_pick),
    jsonb_build_object('picked', (
      select jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'locked', p.locked)
                       order by array_position(v_pick, p.id))
      from public.players p where p.id = any(v_pick))),
    coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  with u as (
    insert into public.perk_uses (channel_id, kick_user_id, draw_id)
    select p_channel, p.kick_user_id, v_draw.id from public.players p where p.id = any(v_perk)
    returning id)
  select coalesce(array_agg(u.id), '{}') into v_uses from u;

  return private.commit(p_channel, b.next_v, b.actor, 'pick_from_' || p_source, null,
    jsonb_build_object('draw', v_draw.id, 'n', p_n),
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_before) e
                  join public.players p on p.id = (e ->> 'id')::uuid where p.changed_v = b.next_v),
      'inserted_perk_uses', to_jsonb(v_uses),
      'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;
drop function public.pick_from_waiting(uuid, integer, uuid, uuid);

-- Clear the teams (August "Sil"): everyone playing goes back to waiting and protections end.
-- The draw stays: it is history, and the rosters are read from the players.
create function public.clear_teams(p_channel uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  v_ids    uuid[];
  v_before jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and (p.status = 'playing' or p.locked);
  if cardinality(v_ids) = 0 then perform private.fail('teams.empty'); end if;

  v_before := private.snapshot(p_channel, v_ids);
  update public.players p set status = 'waiting', team = null, locked = false,
    changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_teams', null,
    jsonb_build_object('n', cardinality(v_ids)), jsonb_build_object('players', v_before), p_request_id);
end $$;

-- Clear the moderation history (August "Geçmişi Temizle"), owner only. Undo brings every row back.
create function public.clear_moderation(p_channel uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b       record;
  v_rows  jsonb;
  v_ids   uuid[];
  v_names text[];
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select jsonb_agg(to_jsonb(m)), array_agg(m.id), array_agg(m.kick_username) into v_rows, v_ids, v_names
  from public.moderation m where m.channel_id = p_channel;
  if v_ids is null then perform private.fail('moderation.empty'); end if;

  delete from public.moderation m where m.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_moderation', null,
    jsonb_build_object('n', cardinality(v_ids)), jsonb_build_object('moderation', v_rows),
    p_request_id, private.moderation_rows(p_channel, v_ids, v_names));
end $$;

revoke execute on function public.shuffle_teams(uuid, uuid, uuid) from public, anon;
revoke execute on function public.pick_players(uuid, integer, text, uuid, uuid) from public, anon;
revoke execute on function public.clear_teams(uuid, uuid) from public, anon;
revoke execute on function public.clear_moderation(uuid, uuid) from public, anon;
grant execute on function public.shuffle_teams(uuid, uuid, uuid) to authenticated;
grant execute on function public.pick_players(uuid, integer, text, uuid, uuid) to authenticated;
grant execute on function public.clear_teams(uuid, uuid) to authenticated;
grant execute on function public.clear_moderation(uuid, uuid) to authenticated;
