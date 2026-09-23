-- Draws (spec § Flows): team draw / reroll and pick from waiting. The result is saved before
-- any animation plays. Randomness is pgcrypto's gen_random_bytes, never random().

-- The draw currently standing, or a row of nulls.
create function private.latest_draw(p_channel uuid) returns public.draws
language sql stable set search_path = '' as $$
  select d.* from public.draws d
  where d.channel_id = p_channel and d.undone_at is null
  order by d.created_at desc limit 1
$$;

-- Someone else drew first (p_base is not the standing draw): draw nothing, return theirs.
-- This is what turns owner and mod pressing Draw at once into one draw.
create function private.stale(p_channel uuid, p_actor text, p_latest public.draws) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('v', c.version, 'kind', 'draw_stale',
    'rows', case when p_latest.id is null then '[]'::jsonb
                 else jsonb_build_array(to_jsonb(p_latest) || '{"_t":"draws"}'::jsonb) end,
    'actor', p_actor)
  from public.channels c where c.id = p_channel
$$;

-- Subscriber perk: newly drawn players with a qualifying badge and uses left in the rolling
-- window are locked (protected from reroll). Returns who was locked; the caller records the
-- perk_uses once the draw row exists.
create function private.apply_perk(p_channel uuid, p_ids uuid[], p_next_v bigint, p_actor text) returns uuid[]
language plpgsql set search_path = '' as $$
declare
  s     public.settings;
  v_ids uuid[];
begin
  select * into s from public.settings x where x.channel_id = p_channel;
  if not s.perk_enabled then return '{}'; end if;
  with q as (
    update public.players p set locked = true, changed_v = p_next_v, changed_by = p_actor
    where p.id = any(p_ids) and not p.locked and p.kick_user_id is not null and p.badges && s.perk_badges
      and (select count(*) from public.perk_uses u
           where u.channel_id = p_channel and u.kick_user_id = p.kick_user_id and u.refunded_at is null
             and u.used_at > now() - make_interval(days => s.perk_window_days)) < s.perk_uses
    returning p.id)
  select coalesce(array_agg(q.id), '{}') into v_ids from q;
  return v_ids;
end $$;

revoke execute on function private.latest_draw(uuid) from public, anon, authenticated;
revoke execute on function private.stale(uuid, text, public.draws) from public, anon, authenticated;
revoke execute on function private.apply_perk(uuid, uuid[], bigint, text) from public, anon, authenticated;

-- Team draw, or reroll of the standing team draw. Pool: waiting, not deleted, not sanctioned.
-- Fresh draw: everyone playing returns to the pool, protections end, and every game-count
-- punishment serves one game. Reroll: protected players keep their team, the rest are drawn
-- again and give back the game the thrown-out draw counted. With fair-play on, the fewest
-- games_played win the slots; ties and everything else are random. Selected players are
-- split at random, as evenly as possible, team 1 taking the odd one.
create function public.draw_teams(p_channel uuid, p_base uuid, p_reroll boolean, p_request_id uuid)
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
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null;

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

  if not p_reroll then
    select jsonb_agg(to_jsonb(m)), array_agg(m.id), array_agg(m.kick_username)
    into v_mod, v_mod_ids, v_mod_names
    from public.moderation m
    where m.channel_id = p_channel and m.kind = 'punish' and m.revoked_at is null and m.games_left > 0;
    update public.moderation m set games_left = m.games_left - 1 where m.id = any(v_mod_ids);
  end if;

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

-- Pick N (1–10) from waiting, without replacement, uniformly (fair-play is for team draws
-- only). Fewer waiting than N picks everyone waiting. Statuses do not change: the streamer
-- moves the winners by hand. A drawn sub with uses left is protected, as in a team draw.
create function public.pick_from_waiting(p_channel uuid, p_n integer, p_base uuid, p_request_id uuid)
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
  if p_n is null or p_n not between 1 and 10 then perform private.fail('request.invalid'); end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;

  select coalesce((array_agg(p.id order by extensions.gen_random_bytes(8)))[1:p_n], '{}') into v_pick
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'waiting'
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

  return private.commit(p_channel, b.next_v, b.actor, 'pick_from_waiting', null,
    jsonb_build_object('draw', v_draw.id, 'n', p_n),
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_before) e
                  join public.players p on p.id = (e ->> 'id')::uuid where p.changed_v = b.next_v),
      'inserted_perk_uses', to_jsonb(v_uses),
      'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;

revoke execute on function public.draw_teams(uuid, uuid, boolean, uuid) from public, anon;
revoke execute on function public.pick_from_waiting(uuid, integer, uuid, uuid) from public, anon;
grant execute on function public.draw_teams(uuid, uuid, boolean, uuid) to authenticated;
grant execute on function public.pick_from_waiting(uuid, integer, uuid, uuid) to authenticated;
