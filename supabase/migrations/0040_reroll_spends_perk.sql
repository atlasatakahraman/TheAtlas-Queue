-- Reroll and the perk (owner, 2026-09-29; DESIGN.md § Subscriber perk). A reroll re-splits the
-- same drawn players, the protected keeping their team, as Shuffle current teams does: nobody new
-- comes in from the queue and no game is counted (0030's reroll sent the unprotected back and drew
-- again from everyone waiting). A fresh draw still protects, but spends no use: a use is spent the
-- first time a reroll or a shuffle keeps a protected player in place, once per draw (the chain of
-- rerolls and shuffles back to its fresh draw), and Undo of that write gives it back. Remove
-- protection refunds only this draw's use, never an older one.

-- The fresh draw a reroll or shuffle chain started from.
-- ponytail: walks rerolled_from, and after-game shuffles extend the chain across games; capped at
-- 500 steps, an anchor column on draws if a stream ever goes past that.
create function private.draw_root(p_draw uuid) returns uuid
language sql stable set search_path = '' as $$
  with recursive up(id, parent, depth) as (
    select d.id, d.rerolled_from, 0 from public.draws d where d.id = p_draw
    union all
    select d.id, d.rerolled_from, up.depth + 1 from up join public.draws d on d.id = up.parent where up.depth < 500
  )
  select up.id from up order by up.depth desc limit 1
$$;
revoke execute on function private.draw_root(uuid) from public, anon, authenticated;

-- Spend a use for each protected player still in a team who has none spent for this draw yet.
create function private.perk_charge(p_channel uuid, p_draw uuid) returns uuid[]
language plpgsql set search_path = '' as $$
declare
  v_root uuid := private.draw_root(p_draw);
  v_ids  uuid[];
begin
  with u as (
    insert into public.perk_uses (channel_id, kick_user_id, draw_id)
    select p_channel, p.kick_user_id, v_root from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.locked
      and p.kick_user_id is not null
      and not exists (select 1 from public.perk_uses x
                      where x.channel_id = p_channel and x.kick_user_id = p.kick_user_id
                        and x.draw_id = v_root and x.refunded_at is null)
    returning id)
  select coalesce(array_agg(u.id), '{}') into v_ids from u;
  return v_ids;
end $$;
revoke execute on function private.perk_charge(uuid, uuid) from public, anon, authenticated;

-- 0030's shuffle_teams body, shared by Shuffle current teams and Reroll, now spending the uses.
create function private.reshuffle(p_channel uuid, p_from uuid, p_next_v bigint, p_actor text, p_request_id uuid, p_kind text)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  s        public.settings;
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
  v_uses   uuid[];
begin
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
    changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_free);

  insert into public.draws (channel_id, kind, n, result, rerolled_from, request_id, created_by)
  values (p_channel, 'teams', s.team_size, private.rosters(p_channel),
    p_from, coalesce(p_request_id, gen_random_uuid()), p_actor)
  returning * into v_draw;

  v_uses := private.perk_charge(p_channel, v_draw.id);

  return private.commit(p_channel, p_next_v, p_actor, p_kind, null,
    jsonb_build_object('draw', v_draw.id),
    jsonb_build_object('players', v_before, 'draw', v_draw.id, 'inserted_perk_uses', to_jsonb(v_uses)),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;
revoke execute on function private.reshuffle(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;

create or replace function public.shuffle_teams(p_channel uuid, p_base uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  v_latest public.draws;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  return private.reshuffle(p_channel, case when v_latest.kind = 'teams' then v_latest.id end,
    b.next_v, b.actor, p_request_id, 'shuffle_teams');
end $$;

-- 0030's draw_teams: a reroll goes to private.reshuffle; a fresh draw protects and spends nothing.
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

  update public.players p set status = 'waiting', team = null, locked = false,
    changed_v = b.next_v, changed_by = b.actor
  where p.channel_id = p_channel and p.deleted_at is null and (p.status = 'playing' or p.locked);

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

-- 0006's remove_protection, refunding only the use spent for this draw.
create or replace function public.remove_protection(p_channel uuid, p_player uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  p      public.players;
  v_use  public.perk_uses;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into p from public.players x
  where x.id = p_player and x.channel_id = p_channel and x.deleted_at is null and x.locked;
  if not found then perform private.fail('request.invalid'); end if;

  v_undo := jsonb_build_object('players', private.snapshot(p_channel, array[p_player]));
  select * into v_use from public.perk_uses u
  where u.channel_id = p_channel and u.kick_user_id = p.kick_user_id and u.refunded_at is null
    and u.draw_id = private.draw_root((select d.id from public.draws d
      where d.channel_id = p_channel and d.undone_at is null and d.kind = 'teams' order by d.created_at desc limit 1))
  limit 1;
  if found then
    v_undo := v_undo || jsonb_build_object('perk_uses', jsonb_build_array(to_jsonb(v_use)));
    update public.perk_uses u set refunded_at = now() where u.id = v_use.id;
  end if;
  update public.players x set locked = false, changed_v = b.next_v, changed_by = b.actor where x.id = p_player;
  return private.commit(p_channel, b.next_v, b.actor, 'remove_protection', p.kick_username,
    '{}'::jsonb, v_undo, p_request_id);
end $$;
