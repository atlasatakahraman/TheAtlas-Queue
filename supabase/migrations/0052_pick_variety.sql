-- Pick variety, the undo chain from All to Team N, and the refund line (spec 2026-11-14 V1–V7).
-- Picks had no memory: every pick drew from the same pool with no record of the last ones, so the
-- same names came back (10% back-to-back with 10 players) and a saved sub stayed in the pool and
-- spent a use on nearly every pick. 0030 fixed the same thing for team splits; picks never got it.
--   V1  Variety memory: the channel's newest 50 kept picks, by lower(name). s = Σ 0.5^(age/5),
--       w = 1/(1+4s)³ (squared repeated back-to-back 2.38% over 5,000 picks; cubed 1.10%, owner
--       2026-11-14). Hidden like 0030: nothing reads it but pick_players. The pool remembers
--       only whom the draw landed on (picked minus stand-ins, plus saved); stand-ins remember
--       every name shown. Counting stand-ins in the pool's memory tilted hits toward subs (Stage 0:
--       522 saves per 1,000 picks against a fair 400; owner chose this split 2026-11-14).
--   V2  Weighted sampling without replacement (Efraimidis–Spirakis): key = ln(u)/w, highest
--       first, u from gen_random_bytes(8) (53 bits, never 0). Pool and stand-ins both.
--   V5  move_players(p_pick): All to Team N names the pick, so undoing the move undoes the pick
--       first (its own write, as 0042's Victory + draw), which refunds its protection.
--   V7  draws.refund_announced_at gates the "pick was undone" chat line, once per draw.
-- Every existing signature stays; move_players gains one optional argument, so the live client
-- keeps working until the push.

-- V1. One index read of ≤ 50 draws, ≤ 10 entries each. p_hit: whom the draw landed on (the
-- pool's memory); otherwise every name shown (the stand-ins' memory).
create function private.pick_weights(p_channel uuid, p_hit boolean) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.name, x.w), '{}'::jsonb)
  from (
    -- float8, not numeric: numeric power() was most of the query's time.
    select lower(e ->> 'kick_username') as name, 1 / power(1 + 4 * sum(power(0.5::float8, h.age / 5.0::float8)), 3) as w
    from (select d.result, row_number() over (order by d.created_at desc) - 1 as age
          from public.draws d
          where d.channel_id = p_channel and d.kind = 'pick' and d.undone_at is null
          order by d.created_at desc limit 50) h,
         jsonb_array_elements(coalesce(h.result -> 'saved', '[]'::jsonb) || coalesce((
           select jsonb_agg(p) from jsonb_array_elements(h.result -> 'picked') p
           where not (p_hit and exists (select 1 from jsonb_array_elements(h.result -> 'saved') s
                                        where s ->> 'standin_id' = p ->> 'id'))), '[]'::jsonb)) e
    where e ->> 'kick_username' is not null
    group by 1) x
$$;
revoke execute on function private.pick_weights(uuid, boolean) from public, anon, authenticated;

-- V2. u = (53 random bits + 0.5) / 2^53, inside (0, 1); a higher key wins.
create function private.es_key(p_w double precision) returns double precision
language sql volatile set search_path = '' as $$
  select ln(((('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64)::bigint & 9007199254740991) + 0.5)
            / 9007199254740992.0) / p_w
$$;
revoke execute on function private.es_key(double precision) from public, anon, authenticated;

-- 0050's body; only the pool and stand-in order change (V2).
create or replace function public.pick_players(p_channel uuid, p_n integer, p_source text, p_base uuid, p_request_id uuid,
  p_again boolean default false, p_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  s        public.settings;
  v_latest public.draws;
  v_draw   public.draws;
  v_w      jsonb;
  v_pool   uuid[];
  v_pick   uuid[];
  v_out    uuid[] := '{}';
  v_prot   uuid[] := '{}';
  v_stand  uuid[] := '{}';
  v_saved  jsonb := '[]'::jsonb;
  v_hit    uuid;
  v_k      integer := 1;
  v_refund jsonb := '[]'::jsonb;
  v_uses   uuid[];
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  -- 512 = settings.queue_max (≤ 500) plus two teams of ≤ 5: one scan of the channel's rows at most.
  if p_n is null or p_n not between 1 and 10 or p_source is null or p_source not in ('waiting', 'teams', 'all', 'custom')
     or p_again is null
     or (p_source = 'custom' and (p_ids is null or cardinality(p_ids) not between 1 and 512))
     or (p_source <> 'custom' and p_ids is not null) then
    perform private.fail('request.invalid');
  end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  select * into s from public.settings x where x.channel_id = p_channel;

  -- Pick again (P7): the pick it replaces costs nothing. Undo restores these rows as they were.
  -- The replaced pick stays in the variety memory, so the re-pick avoids the same names (V1).
  if p_again and v_latest.kind = 'pick' then
    select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_refund
    from public.perk_uses u where u.channel_id = p_channel and u.draw_id = v_latest.id and u.refunded_at is null;
    update public.perk_uses u set refunded_at = now()
    where u.channel_id = p_channel and u.draw_id = v_latest.id and u.refunded_at is null;
  end if;

  v_w := private.pick_weights(p_channel, true);
  select coalesce(array_agg(p.id order by private.es_key(coalesce((v_w ->> lower(p.kick_username))::float8, 1)) desc), '{}')
  into v_pool
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null
    and p.status = any(case p_source when 'waiting' then array['waiting'] when 'teams' then array['playing']
                                     else array['waiting', 'playing'] end)
    and (p_source <> 'custom' or p.id = any(p_ids))
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null;
  v_pick := v_pool[1:p_n];
  if cardinality(v_pick) = 0 then perform private.fail('draw.not_enough'); end if;

  if p_source = 'teams' and s.perk_enabled then
    select coalesce(array_agg(p.id), '{}') into v_prot
    from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
      and p.kick_user_id is not null and private.perk_eligible(p_channel, p.kick_user_id, p.badges)
      and private.perk_left(p_channel, p.kick_user_id) > 0;
    v_w := private.pick_weights(p_channel, false);
    select coalesce(array_agg(p.id order by private.es_key(coalesce((v_w ->> lower(p.kick_username))::float8, 1)) desc), '{}')
    into v_stand
    from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
      and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null
      and p.id <> all (v_pick) and p.id <> all (v_prot);
    foreach v_hit in array v_pick loop
      if v_hit = any(v_prot) then
        v_saved := v_saved || jsonb_build_object(
          'id', v_hit,
          'kick_username', (select p.kick_username from public.players p where p.id = v_hit),
          'standin_id', v_stand[v_k],  -- null past the end: protection holds, the slot goes (P6)
          'left', private.perk_left(p_channel, (select p.kick_user_id from public.players p where p.id = v_hit)) - 1);
        if v_k <= cardinality(v_stand) then
          v_out := v_out || v_stand[v_k];
          v_k := v_k + 1;
        end if;
      else
        v_out := v_out || v_hit;
      end if;
    end loop;
    v_pick := v_out;
  end if;

  insert into public.draws (channel_id, kind, n, result, request_id, created_by)
  values (p_channel, 'pick', p_n,
    jsonb_build_object(
      'picked', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username)
                                           order by array_position(v_pick, p.id)), '[]'::jsonb)
                 from public.players p where p.id = any(v_pick)),
      'saved', v_saved,
      'source', p_source)
      || case when p_source = 'custom' then jsonb_build_object('pool', to_jsonb(v_pool)) else '{}'::jsonb end,
    coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  with u as (
    insert into public.perk_uses (channel_id, kick_user_id, draw_id)
    select p_channel, p.kick_user_id, v_draw.id
    from jsonb_array_elements(v_saved) e join public.players p on p.id = (e ->> 'id')::uuid
    returning id)
  select coalesce(array_agg(u.id), '{}') into v_uses from u;

  return private.commit(p_channel, b.next_v, b.actor, 'pick_from_' || p_source, null,
    jsonb_build_object('draw', v_draw.id, 'n', p_n, 'saved', jsonb_array_length(v_saved)),
    jsonb_build_object('inserted_perk_uses', to_jsonb(v_uses), 'perk_uses', v_refund, 'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;

-- V5. 0019's body plus p_pick: a kept pick of this channel, or request.invalid. Its activity
-- becomes `then`, which undo runs first (0042).
drop function public.move_players(uuid, uuid[], smallint, uuid);
create function public.move_players(p_channel uuid, p_ids uuid[], p_team smallint, p_request_id uuid,
  p_pick uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_ids  uuid[];
  v_undo jsonb;
  v_then bigint;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_team is null or p_team not in (1, 2) or p_ids is null or cardinality(p_ids) not between 1 and 10 then
    perform private.fail('request.invalid');
  end if;
  if p_pick is not null then
    select x.id into v_then from public.activity x
    where x.channel_id = p_channel and x.undone_at is null and x.undo ->> 'draw' = p_pick::text
      and exists (select 1 from public.draws d where d.id = p_pick and d.channel_id = p_channel
                                                 and d.kind = 'pick' and d.undone_at is null)
    order by x.id desc limit 1;
    if v_then is null then perform private.fail('request.invalid'); end if;
  end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from public.players x
  where x.id = any(p_ids) and x.channel_id = p_channel and x.deleted_at is null
    and not (x.status = 'playing' and x.team = p_team);
  if cardinality(v_ids) = 0 then perform private.fail('request.invalid'); end if;

  if (select count(*) from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
     + cardinality(v_ids) > (select s.team_size from public.settings s where s.channel_id = p_channel) then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  v_undo := private.snapshot(p_channel, v_ids);
  update public.players x set status = 'playing', team = p_team, changed_v = b.next_v, changed_by = b.actor
  where x.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'move_players', null,
    jsonb_build_object('team', p_team, 'n', cardinality(v_ids)),
    jsonb_build_object('players', v_undo) || case when v_then is null then '{}'::jsonb
                                                  else jsonb_build_object('then', v_then) end,
    p_request_id);
end $$;
revoke execute on function public.move_players(uuid, uuid[], smallint, uuid, uuid) from public, anon;
grant execute on function public.move_players(uuid, uuid[], smallint, uuid, uuid) to authenticated;

-- V7. Draws undone before this migration were never told to chat; they stay quiet.
alter table public.draws add column refund_announced_at timestamptz;
update public.draws set refund_announced_at = undone_at where undone_at is not null and announced_at is not null;

-- V7. Sets the gate and returns who to tell, with what they have now, in one statement, so two
-- dashboards never both announce. Service role only (the server action has checked membership).
create function public.announce_refunds(p_channel uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  with d as (
    update public.draws d set refund_announced_at = now()
    where d.channel_id = p_channel and d.kind = 'pick' and d.announced_at is not null
      and d.undone_at is not null and d.refund_announced_at is null
    returning d.result)
  select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'kick_username',
                                               'uses', private.perk_left(p_channel, p.kick_user_id))), '[]'::jsonb)
  from d, jsonb_array_elements(coalesce(d.result -> 'saved', '[]'::jsonb)) e
  join public.players p on p.id = (e ->> 'id')::uuid
  where p.kick_user_id is not null
$$;
revoke execute on function public.announce_refunds(uuid) from public, anon, authenticated;
grant execute on function public.announce_refunds(uuid) to service_role;

-- V7. The refund line can be renamed like the other chat replies (0049's list plus one key).
create or replace function private.labels_valid(l jsonb) returns boolean
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
        'chat.joined', 'chat.joined.many', 'chat.rejected.banned', 'chat.rejected.duplicate',
        'chat.rejected.offline', 'chat.rejected.closed', 'chat.position', 'chat.perk', 'chat.perk.none',
        'chat.perk.saved', 'chat.perk.refilled', 'chat.perk.refunded',
        'chat.commands', 'chat.watch', 'chat.rules'
      ]) then return false; end if;
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 80 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
