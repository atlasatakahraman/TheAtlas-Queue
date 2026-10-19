-- One end of the queue (review 2026-10-19, findings 3–5; spec 2026-10-18 § 1).
--   3  private.requeue keyed off the clock alone, but a drag to the bottom keys the last player
--      + 1 s, so a player sent off a team inside that window landed above them. The end is now
--      past every key in the channel's queue, whatever its status, and past the clock.
--   4  move_player and private.settle kept their own inline copy of the old rule; both now go
--      through private.requeue, so there is one definition of "the end".
--   5  replace_player's extra row lock is dropped: private.begin and private.lock_broadcaster
--      both lock the same channels row, so chat intake is already serialised with it, and the
--      lock was not scoped to p_channel.
-- Bodies are the live ones (0043, 0042, 0046); only the lines named above change. Same
-- signatures and grants, so the live client is unaffected and this can be applied before a push.

-- Others only: a requeued player's own old key never pushes the end further. Steps of 1 ms keep
-- players returned together in their old order (R2).
create or replace function private.requeue(p_ids uuid[]) returns void
language sql set search_path = '' as $$  -- runs inside the definer RPCs, like private.snapshot
  update public.players p
  set sort_key = greatest(extract(epoch from clock_timestamp()),
                          coalesce((select max(m.sort_key) from public.players m
                                    where m.channel_id = p.channel_id and m.deleted_at is null and m.id <> all (p_ids)), 0))
                 + o.rn * 0.001
  from (select x.id, row_number() over (order by x.sort_key, x.joined_at) rn
        from public.players x where x.id = any(p_ids)) o
  where p.id = o.id
$$;

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
  update public.players x set status = p_status, team = p_team, sort_key = coalesce(p_key, x.sort_key),
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_player;
  -- p is the row before the update: off a team (R1, R3) means the end of the queue.
  if p_key is null and p.status = 'playing' and p_status <> 'playing' then
    perform private.requeue(array[p_player]);
  end if;
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

CREATE OR REPLACE FUNCTION private.settle(p_channel uuid, p_next_v bigint, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ban    uuid[];
  v_pun    uuid[];
  v_free   uuid[];
  v_back   uuid[];
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
  -- Punished off a team means the end of the queue, the same end as every other return.
  select coalesce(array_agg(p.id), '{}') into v_back from public.players p where p.id = any(v_free) and p.punished_from_team;
  update public.players p set status = 'waiting',
    punished_from_team = false, changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_free);
  if cardinality(v_back) > 0 then perform private.requeue(v_back); end if;
  perform set_config('queue.settling', 'off', true);
  return v_before;
end $function$;

create or replace function public.replace_player(p_channel uuid, p_out uuid, p_in uuid, p_request_id uuid, p_remove boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_out  public.players;
  v_in   public.players;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_remove is null then perform private.fail('request.invalid'); end if;
  select * into v_out from public.players x
  where x.id = p_out and x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing';
  if not found then perform private.fail('request.invalid'); end if;
  select * into v_in from public.players x
  where x.id = p_in and x.channel_id = p_channel and x.deleted_at is null and x.status = 'waiting';
  if not found then perform private.fail('request.invalid'); end if;
  if private.sanction(p_channel, v_in.kick_username, v_in.kick_user_id) is not null then
    perform private.fail('draw.barred', jsonb_build_object('name', v_in.kick_username));
  end if;

  v_undo := private.snapshot(p_channel, array[p_out, p_in]);
  -- Outgoing first: private.team_slot nulls its slot, so the incoming row never shares it.
  update public.players x set status = 'waiting', team = null,
    deleted_at = case when p_remove then now() end,
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_out;
  if not p_remove then perform private.requeue(array[p_out]); end if;
  update public.players x set status = 'playing', team = v_out.team, team_slot = v_out.team_slot,
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_in;
  return private.commit(p_channel, b.next_v, b.actor, 'replace_player', v_out.kick_username,
    jsonb_build_object('out', v_out.kick_username, 'in', v_in.kick_username, 'team', v_out.team)
      || case when p_remove then '{"removed": true}'::jsonb else '{}'::jsonb end,
    jsonb_build_object('players', v_undo), p_request_id);
end $$;
