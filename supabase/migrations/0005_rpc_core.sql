-- Shared machinery for every RPC. Contracts: vault stages/2026-09-23-queue-rewrite-stage-2.md.

-- Stable error keys (spec § Error handling): message is the key, detail is JSON or empty.
create function private.fail(p_key text, p_detail jsonb default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using message = p_key, errcode = 'P0001', detail = coalesce(p_detail::text, '');
end $$;

-- Start of every member/owner RPC: role check, channel row lock (serialises writes per
-- channel, so two draws cannot interleave), the actor's name, the version this write will
-- produce, and whether request_id was already applied.
create function private.begin(p_channel uuid, p_owner_only boolean, p_request_id uuid,
  out actor text, out next_v bigint, out replay boolean)
language plpgsql set search_path = '' as $$
declare
  v_role text;
begin
  v_role := private.member_role(p_channel);
  if v_role is null then perform private.fail('auth.not_member'); end if;
  if p_owner_only and v_role <> 'owner' then perform private.fail('auth.role'); end if;
  select c.version + 1 into next_v from public.channels c where c.id = p_channel for update;
  select p.username into actor from public.profiles p where p.id = (select auth.uid());
  replay := p_request_id is not null
    and exists (select 1 from public.activity a where a.request_id = p_request_id);
end $$;

-- What a replayed request returns: nothing new, the current version.
create function private.replay(p_channel uuid, p_actor text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('v', c.version, 'kind', 'replay', 'rows', '[]'::jsonb, 'actor', p_actor)
  from public.channels c where c.id = p_channel
$$;

-- A player as the client sees it: the row plus the cached rank.
create function private.player_json(p public.players) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(p) || jsonb_build_object('_t', 'players', 'rank',
    (select jsonb_build_object('tier', r.tier, 'division', r.division, 'lp', r.league_points, 'icon', r.icon)
     from public.riot_cache r where r.puuid = p.puuid))
$$;

-- Active sanction for a name or Kick user id: 'ban', 'punish' or null.
create function private.sanction(p_channel uuid, p_username text, p_kick_user_id bigint) returns text
language sql stable set search_path = '' as $$
  select m.kind from public.moderation m
  where m.channel_id = p_channel and m.kind in ('ban', 'punish') and m.revoked_at is null
    and (m.expires_at is null or m.expires_at > now())
    and (m.games_left is null or m.games_left > 0)
    and (lower(m.kick_username) = lower(p_username)
         or (p_kick_user_id is not null and m.kick_user_id = p_kick_user_id))
  order by m.kind = 'ban' desc
  limit 1
$$;

-- Port of the August computeRespect: start at 100; warning 10, punishment 20, ban 50; the Nth
-- offence ×1/1/1.5/2/2.5; older than 7/14/30 days ×0.75/0.5/0.25. A revoked warning no longer
-- counts (the August hook deleted it); a lifted punishment or ban still does.
create function private.respect(p_channel uuid, p_username text) returns integer
language sql stable set search_path = '' as $$
  with o as (
    select m.created_at,
      case m.kind when 'warn' then 10 when 'punish' then 20 else 50 end as base,
      row_number() over (order by m.created_at) - 1 as i
    from public.moderation m
    where m.channel_id = p_channel and lower(m.kick_username) = lower(p_username)
      and (m.kind <> 'warn' or m.revoked_at is null)
  )
  select greatest(0, least(100, round(100 - coalesce(sum(
    o.base
    * (array[1.0, 1.0, 1.5, 2.0, 2.5])[least(o.i, 4) + 1]
    * case when now() - o.created_at >= interval '30 days' then 0.25
           when now() - o.created_at >= interval '14 days' then 0.5
           when now() - o.created_at >= interval '7 days'  then 0.75
           else 1.0 end), 0))))::integer
  from o
$$;

-- Moderation rows (deleted ones as tombstones) and the respect of every name involved.
create function private.moderation_rows(p_channel uuid, p_ids uuid[], p_names text[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((
      select jsonb_agg(coalesce(to_jsonb(m) || '{"_t":"moderation"}'::jsonb,
                                jsonb_build_object('_t', 'moderation', 'id', i, '_deleted', true)))
      from unnest(p_ids) i left join public.moderation m on m.id = i and m.channel_id = p_channel), '[]'::jsonb)
    || coalesce((
      select jsonb_agg(jsonb_build_object('_t', 'respect', 'kick_username', n, 'points', private.respect(p_channel, n)))
      from (select distinct lower(x) as n from unnest(p_names) x) d), '[]'::jsonb)
$$;

-- Who may join: not banned, not punished, not already in the queue, Riot ID when required.
-- Shared by add_player now and ingest_chat (Stage 3).
create function private.join_check(p_channel uuid, p_username text, p_kick_user_id bigint, p_riot_id text)
returns void
language plpgsql set search_path = '' as $$
declare
  v_s    text;
  v_name text;
begin
  v_s := private.sanction(p_channel, p_username, p_kick_user_id);
  if v_s = 'ban' then perform private.fail('queue.banned'); end if;
  if v_s = 'punish' then perform private.fail('queue.punished'); end if;
  select p.kick_username into v_name from public.players p
  where p.channel_id = p_channel and p.deleted_at is null
    and (lower(p.kick_username) = lower(p_username)
         or (p_kick_user_id is not null and p.kick_user_id = p_kick_user_id))
  limit 1;
  if found then perform private.fail('queue.duplicate', jsonb_build_object('name', v_name)); end if;
  if p_riot_id is null then
    if (select s.require_riot_id from public.settings s where s.channel_id = p_channel) then
      perform private.fail('queue.riot_required');
    end if;
  elsif p_riot_id !~ '^[^#]{3,16}#[A-Za-z0-9]{3,5}$' then
    perform private.fail('queue.riot_required');
  end if;
end $$;

-- End of every write: the activity row (with its inverse), one realtime event, and the same
-- event as the return value. Player rows written at p_next_v are included automatically.
create function private.commit(p_channel uuid, p_next_v bigint, p_actor text, p_action text,
  p_target text, p_payload jsonb, p_undo jsonb, p_request_id uuid, p_rows jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_act  public.activity;
  v_rows jsonb;
  v_v    bigint;
begin
  insert into public.activity (channel_id, v, actor, action, target, payload, undo, request_id)
  values (p_channel, p_next_v, p_actor, p_action, p_target, coalesce(p_payload, '{}'::jsonb), p_undo, p_request_id)
  returning * into v_act;

  select coalesce(jsonb_agg(private.player_json(p) order by p.joined_at), '[]'::jsonb) into v_rows
  from public.players p where p.channel_id = p_channel and p.changed_v = p_next_v;
  v_rows := v_rows || coalesce(p_rows, '[]'::jsonb)
    || jsonb_build_array((to_jsonb(v_act) - 'undo') || '{"_t":"activity"}'::jsonb);

  v_v := private.emit(p_channel, p_action, v_rows, p_actor);
  if v_v <> p_next_v then raise exception 'version drift: % <> %', v_v, p_next_v; end if;
  return jsonb_build_object('v', v_v, 'kind', p_action, 'rows', v_rows, 'actor', p_actor);
end $$;

revoke execute on function private.fail(text, jsonb) from public, anon, authenticated;
revoke execute on function private.begin(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function private.replay(uuid, text) from public, anon, authenticated;
revoke execute on function private.player_json(public.players) from public, anon, authenticated;
revoke execute on function private.sanction(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function private.respect(uuid, text) from public, anon, authenticated;
revoke execute on function private.moderation_rows(uuid, uuid[], text[]) from public, anon, authenticated;
revoke execute on function private.join_check(uuid, text, bigint, text) from public, anon, authenticated;
revoke execute on function private.commit(uuid, bigint, text, text, text, jsonb, jsonb, uuid, jsonb) from public, anon, authenticated;

-- Everything the dashboard shows, in one snapshot with its version (spec § Realtime: refetch
-- on SUBSCRIBED, reconnect, refocus and on a version gap).
create function public.get_state(p_channel uuid) returns jsonb
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
                  from public.channel_members m where m.channel_id = c.id)
    )
    from public.channels c where c.id = p_channel
  );
end $$;
revoke execute on function public.get_state(uuid) from public, anon;
grant execute on function public.get_state(uuid) to authenticated;

-- Server-side undo: applies the inverse the original write stored. Refuses with undo.changed
-- (naming who) when any player it would restore has been written since.
create function public.undo(p_channel uuid, p_activity bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  a        public.activity;
  v_by     text;
  v_mod    uuid[];
  v_names  text[];
  v_rows   jsonb := '[]'::jsonb;
begin
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
      games_played = r.games_played, changed_v = b.next_v, changed_by = b.actor
    from jsonb_populate_recordset(null::public.players, coalesce(a.undo -> 'players', '[]'::jsonb)) r
    where p.id = r.id and p.channel_id = p_channel;
  exception when unique_violation then
    perform private.fail('queue.duplicate');
  end;
  perform set_config('queue.restoring', 'off', true);
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
  on conflict (id) do update set revoked_at = excluded.revoked_at, games_left = excluded.games_left;
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

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $$;
revoke execute on function public.undo(uuid, bigint, uuid) from public, anon;
grant execute on function public.undo(uuid, bigint, uuid) to authenticated;
