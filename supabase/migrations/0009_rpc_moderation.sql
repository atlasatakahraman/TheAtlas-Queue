-- Moderation RPCs (members): warn, punish, ban, revoke, delete. Sanctions are keyed by Kick
-- username, plus the Kick user id when the target is in the queue. Every return carries the
-- target's recomputed respect.

-- Trimmed target name, or request.invalid.
create function private.target_name(p_name text) returns text
language plpgsql set search_path = '' as $$
begin
  p_name := btrim(p_name);
  if p_name is null or p_name !~ '^\S{1,40}$' then perform private.fail('request.invalid'); end if;
  return p_name;
end $$;

-- The Kick user id of a live queue row with that name, if any.
create function private.target_user(p_channel uuid, p_name text) returns bigint
language sql stable set search_path = '' as $$
  select p.kick_user_id from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and lower(p.kick_username) = lower(p_name)
$$;

revoke execute on function private.target_name(text) from public, anon, authenticated;
revoke execute on function private.target_user(uuid, text) from public, anon, authenticated;

-- First warning: level 1. Second while the first stands: stored as level 2, both warnings are
-- spent (revoked) and a 1-game punishment follows, as in the August build.
create function public.warn(p_channel uuid, p_kick_username text, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  v_name   text;
  v_user   bigint;
  v_before jsonb;
  v_prior  uuid[];
  v_new    uuid[];
  v_id     uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_name := private.target_name(p_kick_username);
  p_reason := coalesce(btrim(p_reason), '');
  if length(p_reason) > 200 then perform private.fail('request.invalid'); end if;
  v_user := private.target_user(p_channel, v_name);

  select jsonb_agg(to_jsonb(m)), array_agg(m.id) into v_before, v_prior
  from public.moderation m
  where m.channel_id = p_channel and m.kind = 'warn' and m.revoked_at is null
    and lower(m.kick_username) = lower(v_name);

  if v_prior is null then
    insert into public.moderation (channel_id, kick_username, kick_user_id, kind, level, reason, created_by)
    values (p_channel, v_name, v_user, 'warn', 1, p_reason, b.actor) returning id into v_id;
    v_new := array[v_id];
  else
    update public.moderation m set revoked_at = now() where m.id = any(v_prior);
    insert into public.moderation (channel_id, kick_username, kick_user_id, kind, level, reason, created_by, revoked_at)
    values (p_channel, v_name, v_user, 'warn', 2, p_reason, b.actor, now()) returning id into v_id;
    v_new := array[v_id];
    insert into public.moderation (channel_id, kick_username, kick_user_id, kind, games_left, reason, created_by)
    values (p_channel, v_name, v_user, 'punish', 1, p_reason, b.actor) returning id into v_id;
    v_new := v_new || v_id;
  end if;

  return private.commit(p_channel, b.next_v, b.actor, 'warn', v_name,
    jsonb_build_object('level', case when v_prior is null then 1 else 2 end, 'punished', v_prior is not null),
    jsonb_build_object('moderation', coalesce(v_before, '[]'::jsonb), 'inserted_moderation', to_jsonb(v_new)),
    p_request_id, private.moderation_rows(p_channel, coalesce(v_prior, '{}') || v_new, array[v_name]));
end $$;

-- Punish for 1–10 games (served by fresh team draws) or for 1 minute to 1 year.
create function public.punish(p_channel uuid, p_kick_username text, p_games integer, p_minutes integer,
  p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_name text;
  v_id   uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_name := private.target_name(p_kick_username);
  p_reason := coalesce(btrim(p_reason), '');
  if length(p_reason) > 200
     or (p_games is null) = (p_minutes is null)
     or p_games not between 1 and 10
     or p_minutes not between 1 and 525600 then
    perform private.fail('request.invalid');
  end if;

  insert into public.moderation (channel_id, kick_username, kick_user_id, kind, games_left, expires_at, reason, created_by)
  values (p_channel, v_name, private.target_user(p_channel, v_name), 'punish', p_games,
          case when p_minutes is not null then now() + make_interval(mins => p_minutes) end, p_reason, b.actor)
  returning id into v_id;
  return private.commit(p_channel, b.next_v, b.actor, 'punish', v_name,
    jsonb_build_object('games', p_games, 'minutes', p_minutes),
    jsonb_build_object('inserted_moderation', jsonb_build_array(v_id)),
    p_request_id, private.moderation_rows(p_channel, array[v_id], array[v_name]));
end $$;

-- Ban for 1–3650 days, or permanently when p_days is null.
create function public.ban(p_channel uuid, p_kick_username text, p_days integer, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_name text;
  v_id   uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  v_name := private.target_name(p_kick_username);
  p_reason := coalesce(btrim(p_reason), '');
  if length(p_reason) > 200 or p_days not between 1 and 3650 then perform private.fail('request.invalid'); end if;

  insert into public.moderation (channel_id, kick_username, kick_user_id, kind, expires_at, reason, created_by)
  values (p_channel, v_name, private.target_user(p_channel, v_name), 'ban',
          case when p_days is not null then now() + make_interval(days => p_days) end, p_reason, b.actor)
  returning id into v_id;
  return private.commit(p_channel, b.next_v, b.actor, 'ban', v_name,
    jsonb_build_object('days', p_days),
    jsonb_build_object('inserted_moderation', jsonb_build_array(v_id)),
    p_request_id, private.moderation_rows(p_channel, array[v_id], array[v_name]));
end $$;

-- Lift a sanction early. A lifted punishment or ban still counts against respect; a revoked
-- warning does not (the August rules).
create function public.revoke_sanction(p_channel uuid, p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  m public.moderation;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x where x.id = p_id and x.channel_id = p_channel and x.revoked_at is null;
  if not found then perform private.fail('request.invalid'); end if;

  update public.moderation x set revoked_at = now() where x.id = p_id;
  return private.commit(p_channel, b.next_v, b.actor, 'revoke_sanction', m.kick_username,
    jsonb_build_object('kind', m.kind),
    jsonb_build_object('moderation', jsonb_build_array(to_jsonb(m))),
    p_request_id, private.moderation_rows(p_channel, array[p_id], array[m.kick_username]));
end $$;

-- Delete a sanction from history (a mistake): it stops counting against respect.
create function public.delete_sanction(p_channel uuid, p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  m public.moderation;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x where x.id = p_id and x.channel_id = p_channel;
  if not found then perform private.fail('request.invalid'); end if;

  delete from public.moderation x where x.id = p_id;
  return private.commit(p_channel, b.next_v, b.actor, 'delete_sanction', m.kick_username,
    jsonb_build_object('kind', m.kind),
    jsonb_build_object('moderation', jsonb_build_array(to_jsonb(m))),
    p_request_id, private.moderation_rows(p_channel, array[p_id], array[m.kick_username]));
end $$;

revoke execute on function public.warn(uuid, text, text, uuid) from public, anon;
revoke execute on function public.punish(uuid, text, integer, integer, text, uuid) from public, anon;
revoke execute on function public.ban(uuid, text, integer, text, uuid) from public, anon;
revoke execute on function public.revoke_sanction(uuid, uuid, uuid) from public, anon;
revoke execute on function public.delete_sanction(uuid, uuid, uuid) from public, anon;
grant execute on function public.warn(uuid, text, text, uuid) to authenticated;
grant execute on function public.punish(uuid, text, integer, integer, text, uuid) to authenticated;
grant execute on function public.ban(uuid, text, integer, text, uuid) to authenticated;
grant execute on function public.revoke_sanction(uuid, uuid, uuid) to authenticated;
grant execute on function public.delete_sanction(uuid, uuid, uuid) to authenticated;
