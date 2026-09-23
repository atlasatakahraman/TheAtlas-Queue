-- Queue RPCs (members). Each: private.begin → write → private.commit with its inverse.

-- Rows as they are now, for an inverse.
create function private.snapshot(p_channel uuid, p_ids uuid[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  from public.players p where p.channel_id = p_channel and p.id = any(p_ids)
$$;
revoke execute on function private.snapshot(uuid, uuid[]) from public, anon, authenticated;

create function public.add_player(p_channel uuid, p_kick_username text, p_riot_id text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b    record;
  v_id uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  p_kick_username := btrim(p_kick_username);
  p_riot_id := nullif(btrim(p_riot_id), '');
  if p_kick_username is null or p_kick_username !~ '^\S{1,40}$' then perform private.fail('request.invalid'); end if;
  perform private.join_check(p_channel, p_kick_username, null, p_riot_id);

  insert into public.players (channel_id, kick_username, riot_id, source, changed_v, changed_by)
  values (p_channel, p_kick_username, p_riot_id, 'manual', b.next_v, b.actor)
  returning id into v_id;
  return private.commit(p_channel, b.next_v, b.actor, 'add_player', p_kick_username,
    jsonb_build_object('riot_id', p_riot_id),
    jsonb_build_object('inserted_players', jsonb_build_array(v_id)), p_request_id);
end $$;

create function public.update_player(p_channel uuid, p_player uuid, p_kick_username text, p_riot_id text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  p_kick_username := btrim(p_kick_username);
  p_riot_id := nullif(btrim(p_riot_id), '');
  if p_kick_username is null or p_kick_username !~ '^\S{1,40}$' then perform private.fail('request.invalid'); end if;
  if p_riot_id is not null and p_riot_id !~ '^[^#]{3,16}#[A-Za-z0-9]{3,5}$' then perform private.fail('queue.riot_required'); end if;
  if p_riot_id is null and (select s.require_riot_id from public.settings s where s.channel_id = p_channel) then
    perform private.fail('queue.riot_required');
  end if;

  v_undo := private.snapshot(p_channel, array[p_player]);
  begin
    update public.players p set
      kick_username = p_kick_username,
      riot_id = p_riot_id,
      puuid = case when p.riot_id is not distinct from p_riot_id then p.puuid end,
      changed_v = b.next_v, changed_by = b.actor
    where p.id = p_player and p.channel_id = p_channel and p.deleted_at is null;
  exception when unique_violation then
    perform private.fail('queue.duplicate', jsonb_build_object('name', p_kick_username));
  end;
  if not found then perform private.fail('request.invalid'); end if;
  return private.commit(p_channel, b.next_v, b.actor, 'update_player', p_kick_username,
    jsonb_build_object('riot_id', p_riot_id), jsonb_build_object('players', v_undo), p_request_id);
end $$;

-- Waiting, away, or playing on team 1/2. A full team refuses with draw.team_full.
create function public.move_player(p_channel uuid, p_player uuid, p_status text, p_team smallint, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  p      public.players;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_status not in ('waiting', 'playing', 'away')
     or (p_status = 'playing') <> (p_team is not null)
     or (p_team is not null and p_team not in (1, 2)) then
    perform private.fail('request.invalid');
  end if;
  select * into p from public.players x where x.id = p_player and x.channel_id = p_channel and x.deleted_at is null;
  if not found then perform private.fail('request.invalid'); end if;

  if p_status = 'playing' and p.team is distinct from p_team
     and (select count(*) from public.players x
          where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
         >= (select s.team_size from public.settings s where s.channel_id = p_channel) then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  v_undo := private.snapshot(p_channel, array[p_player]);
  update public.players x set status = p_status, team = p_team, changed_v = b.next_v, changed_by = b.actor
  where x.id = p_player;
  return private.commit(p_channel, b.next_v, b.actor, 'move_player', p.kick_username,
    jsonb_build_object('status', p_status, 'team', p_team), jsonb_build_object('players', v_undo), p_request_id);
end $$;

-- Soft-remove the given players, or everyone when p_ids is null (clear queue). Purged after
-- 10 minutes; until then undo brings them back.
create function public.remove_players(p_channel uuid, p_ids uuid[], p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_ids  uuid[];
  v_name text;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select array_agg(p.id), min(p.kick_username) into v_ids, v_name
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and (p_ids is null or p.id = any(p_ids));
  if v_ids is null then perform private.fail('request.invalid'); end if;

  v_undo := private.snapshot(p_channel, v_ids);
  update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
  where p.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor,
    case when p_ids is null then 'clear_queue' else 'remove_players' end,
    case when cardinality(v_ids) = 1 then v_name end,
    jsonb_build_object('count', cardinality(v_ids)),
    jsonb_build_object('players', v_undo), p_request_id);
end $$;

-- Row menu → Remove protection: the sub goes back to the reroll pool and the perk use is refunded.
create function public.remove_protection(p_channel uuid, p_player uuid, p_request_id uuid)
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
  order by u.used_at desc limit 1;
  if found then
    v_undo := v_undo || jsonb_build_object('perk_uses', jsonb_build_array(to_jsonb(v_use)));
    update public.perk_uses u set refunded_at = now() where u.id = v_use.id;
  end if;
  update public.players x set locked = false, changed_v = b.next_v, changed_by = b.actor where x.id = p_player;
  return private.commit(p_channel, b.next_v, b.actor, 'remove_protection', p.kick_username,
    '{}'::jsonb, v_undo, p_request_id);
end $$;

-- The fair-play switch sits on the Teams tab, which moderators see, so it is a member RPC;
-- every other setting is owner-only (update_settings).
create function public.set_fair_play(p_channel uuid, p_on boolean, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_rows jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_on is null then perform private.fail('request.invalid'); end if;
  update public.settings s set fair_play = p_on, updated_at = now() where s.channel_id = p_channel
  returning jsonb_build_array(to_jsonb(s) || '{"_t":"settings"}'::jsonb) into v_rows;
  return private.commit(p_channel, b.next_v, b.actor, 'set_fair_play', null,
    jsonb_build_object('on', p_on), null, p_request_id, v_rows);
end $$;

revoke execute on function public.add_player(uuid, text, text, uuid) from public, anon;
revoke execute on function public.update_player(uuid, uuid, text, text, uuid) from public, anon;
revoke execute on function public.move_player(uuid, uuid, text, smallint, uuid) from public, anon;
revoke execute on function public.remove_players(uuid, uuid[], uuid) from public, anon;
revoke execute on function public.remove_protection(uuid, uuid, uuid) from public, anon;
revoke execute on function public.set_fair_play(uuid, boolean, uuid) from public, anon;
grant execute on function public.add_player(uuid, text, text, uuid) to authenticated;
grant execute on function public.update_player(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.move_player(uuid, uuid, text, smallint, uuid) to authenticated;
grant execute on function public.remove_players(uuid, uuid[], uuid) to authenticated;
grant execute on function public.remove_protection(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_fair_play(uuid, boolean, uuid) to authenticated;
