-- Stage 12, D38: teammate variety in the split. A hidden score for how often two players have
-- already been on the same team, so a draw's split does not keep pairing the same people (true
-- randomness repeats, and repeats look rigged on stream). Read from the kept games only, inside
-- the draw RPCs only: never in get_state, events, the UI, the public pages or chat.

-- Identity by Kick user id (ADR 0011). record_game writes game_players by name from the players
-- it just read; the trigger adds the id of that same, current row (names are unique among the
-- channel's current players), and an undo that restores a row without one fills it again.
alter table public.game_players add column kick_user_id bigint;
update public.game_players gp set kick_user_id = p.kick_user_id
from public.players p
where p.channel_id = gp.channel_id and lower(p.kick_username) = gp.name and p.deleted_at is null
  and p.kick_user_id is not null;

create function private.game_player_id() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.kick_user_id := (select p.kick_user_id from public.players p
    where p.channel_id = new.channel_id and lower(p.kick_username) = new.name and p.deleted_at is null);
  return new;
end $$;
revoke execute on function private.game_player_id() from public, anon, authenticated;
create trigger game_players_kick_user_id before insert on public.game_players
  for each row when (new.kick_user_id is null) execute function private.game_player_id();

-- Which of p_free go to team 1 (p_need1 of them), the protected p_fixed1 / p_fixed2 staying put.
-- Every split is scored by the pair weights inside each team: each kept game two players shared
-- a team adds 0.5^(age / 5), age 0 for the newest (half-life 5 games; an undone or removed game
-- is not read, so it drops out by itself). One split is chosen uniformly at random among the
-- lowest-scoring. Up to 10 free players (team size 5 at most, so always today) every split is
-- scored (C(10, 5) = 252); above that, 256 random splits are sampled. No history: every split
-- scores 0, a plain random split.
-- ponytail: the newest 50 games only (0.5^10 ≈ 0.001); older pairings no longer move a split.
create function private.split_teams(p_channel uuid, p_free uuid[], p_need1 integer, p_fixed1 uuid[], p_fixed2 uuid[])
returns uuid[]
language plpgsql volatile set search_path = '' as $$
declare
  v_n    integer := cardinality(p_free);
  v_pick integer[];
begin
  if p_need1 <= 0 then return '{}'; end if;
  if p_need1 >= v_n then return p_free; end if;
  with recursive combo(c) as (
    select array[i] from generate_series(1, v_n) i where v_n <= 10
    union all
    select combo.c || i from combo, generate_series(combo.c[cardinality(combo.c)] + 1, v_n) i
    where cardinality(combo.c) < p_need1
  ), cand(c) as (
    select combo.c from combo where cardinality(combo.c) = p_need1
    union all
    select (select array_agg(x.i order by x.i) from (
              select i from generate_series(1, v_n) i where s > 0 order by extensions.gen_random_bytes(8) limit p_need1) x)
    from generate_series(1, 256) s where v_n > 10
  ), who as (
    select p.id, coalesce(p.kick_user_id::text, lower(p.kick_username)) k
    from public.players p where p.id = any(p_free || p_fixed1 || p_fixed2)
  ), recent as (
    select g.id, row_number() over (order by g.n desc) - 1 age
    from public.games g where g.channel_id = p_channel and g.removed_at is null
    order by g.n desc limit 50
  ), seen as (
    select r.id game, r.age, gp.team, coalesce(gp.kick_user_id::text, gp.name) k
    from recent r join public.game_players gp on gp.game_id = r.id
  ), pair as (
    select a.k a, b.k b, sum(power(0.5, a.age / 5.0)) w
    from seen a join seen b on b.game = a.game and b.team = a.team and b.k > a.k
    group by a.k, b.k
  ), side as (
    select cand.c, f.id, case when f.i = any(cand.c) then 1 else 2 end t from cand, unnest(p_free) with ordinality f(id, i)
    union all select cand.c, x, 1 from cand, unnest(p_fixed1) x
    union all select cand.c, x, 2 from cand, unnest(p_fixed2) x
  ), keyed as (
    select side.c, side.t, who.k from side join who on who.id = side.id
  ), score as (
    select a.c, sum(pair.w) s
    from keyed a join keyed b on b.c = a.c and b.t = a.t and b.k > a.k
    join pair on pair.a = a.k and pair.b = b.k
    group by a.c
  )
  select cand.c into v_pick from cand left join score on score.c = cand.c
  order by round(coalesce(score.s, 0)::numeric, 9), extensions.gen_random_bytes(8) limit 1;
  return (select array_agg(p_free[i]) from unnest(v_pick) i);
end $$;
revoke execute on function private.split_teams(uuid, uuid[], integer, uuid[], uuid[]) from public, anon, authenticated;

-- 0027's draw_teams and 0016's shuffle_teams, their split now through private.split_teams.
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

create or replace function public.shuffle_teams(p_channel uuid, p_base uuid, p_request_id uuid)
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
  v_ids1   uuid[];
  v_ids2   uuid[];
  v_team1  uuid[];
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  select * into s from public.settings x where x.channel_id = p_channel;

  select count(*) filter (where p.locked and p.team = 1), count(*) filter (where p.locked and p.team = 2),
         coalesce(array_agg(p.id order by extensions.gen_random_bytes(8)) filter (where not p.locked), '{}'),
         coalesce(array_agg(p.id) filter (where p.locked and p.team = 1), '{}'),
         coalesce(array_agg(p.id) filter (where p.locked and p.team = 2), '{}')
  into v_fixed1, v_fixed2, v_free, v_ids1, v_ids2
  from public.players p where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing';
  v_total := v_fixed1 + v_fixed2 + cardinality(v_free);
  if v_total < 2 or cardinality(v_free) = 0 then perform private.fail('draw.not_enough'); end if;
  v_need1 := least(greatest(ceil(v_total / 2.0)::integer - v_fixed1, 0), cardinality(v_free));

  v_team1 := private.split_teams(p_channel, v_free, v_need1, v_ids1, v_ids2);
  v_before := private.snapshot(p_channel, v_free);
  update public.players p set team = case when p.id = any(v_team1) then 1 else 2 end,
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
