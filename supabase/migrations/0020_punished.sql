-- Punished players leave the queue (owner, 2026-09-27). A punishment seats a queued player in
-- Punished (out of their team or waiting); when it ends (its time, its games, lifted or deleted)
-- they go back to waiting at their place, or to the end of waiting when a team lost them. A ban
-- removes them from the queue. private.settle does all of it and every sanction write calls it;
-- private.settle_all, run each minute by 0021, settles what time and draws end.
alter table public.players drop constraint players_status_check;
alter table public.players add constraint players_status_check
  check (status in ('waiting', 'playing', 'away', 'punished'));
alter table public.players add column punished_from_team boolean not null default false;

-- Nothing but settle and undo takes a player out of Punished: a move or a chat command refuses.
create function private.players_punished_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'punished' and new.status <> 'punished'
     and coalesce(current_setting('queue.settling', true), '') <> 'on'
     and coalesce(current_setting('queue.restoring', true), '') <> 'on' then
    perform private.fail('queue.punished');
  end if;
  return new;
end $$;
create trigger players_punished_guard before update of status on public.players
  for each row execute function private.players_punished_guard();

-- Brings a channel's queue in line with its sanctions and returns the changed rows as they were,
-- for the caller's undo. A player leaving a team for Punished loses their protection too.
-- ponytail: undoing a release puts the player back in Punished without their from-team mark, so
-- they later return to their old place instead of the end; a column in undo's restore fixes it.
create function private.settle(p_channel uuid, p_next_v bigint, p_actor text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_ban    uuid[];
  v_pun    uuid[];
  v_free   uuid[];
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
  update public.players p set status = 'punished', team = null, locked = false,
    punished_from_team = (p.status = 'playing'), changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_pun);
  update public.players p set status = 'waiting',
    sort_key = case when p.punished_from_team then extract(epoch from clock_timestamp()) else p.sort_key end,
    punished_from_team = false, changed_v = p_next_v, changed_by = p_actor
  where p.id = any(v_free);
  perform set_config('queue.settling', 'off', true);
  return v_before;
end $$;
revoke execute on function private.settle(uuid, bigint, text) from public, anon, authenticated;

-- The minutely job: every channel whose sanctions and queue disagree (a punishment's time ran
-- out, a draw served its last game) is settled in its own write, one event each.
create function private.settle_all() returns void
language plpgsql set search_path = '' as $$
declare
  v_ch     uuid;
  v_next   bigint;
  v_before jsonb;
begin
  for v_ch in
    select distinct p.channel_id from public.players p
    cross join lateral (select private.sanction(p.channel_id, p.kick_username, p.kick_user_id) s) x
    where p.deleted_at is null and (x.s = 'ban' or (x.s is not distinct from 'punish') <> (p.status = 'punished'))
  loop
    select c.version + 1 into v_next from public.channels c where c.id = v_ch for update;
    v_before := private.settle(v_ch, v_next, null);
    if jsonb_array_length(v_before) > 0 then
      perform private.commit(v_ch, v_next, null, 'settle', null,
        jsonb_build_object('n', jsonb_array_length(v_before)), null, null);
    end if;
  end loop;
end $$;
revoke execute on function private.settle_all() from public, anon, authenticated;


create or replace function public.warn(p_channel uuid, p_kick_username text, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
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

  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'warn', v_name,
    jsonb_build_object('level', case when v_prior is null then 1 else 2 end, 'punished', v_prior is not null),
    jsonb_build_object('players', v_players, 'moderation', coalesce(v_before, '[]'::jsonb), 'inserted_moderation', to_jsonb(v_new)),
    p_request_id, private.moderation_rows(p_channel, coalesce(v_prior, '{}') || v_new, array[v_name]));
end $$;

create or replace function public.punish(p_channel uuid, p_kick_username text, p_games integer, p_minutes integer,
  p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
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
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'punish', v_name,
    jsonb_build_object('games', p_games, 'minutes', p_minutes),
    jsonb_build_object('players', v_players, 'inserted_moderation', jsonb_build_array(v_id)),
    p_request_id, private.moderation_rows(p_channel, array[v_id], array[v_name]));
end $$;

create or replace function public.ban(p_channel uuid, p_kick_username text, p_days integer, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
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
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'ban', v_name,
    jsonb_build_object('days', p_days),
    jsonb_build_object('players', v_players, 'inserted_moderation', jsonb_build_array(v_id)),
    p_request_id, private.moderation_rows(p_channel, array[v_id], array[v_name]));
end $$;

create or replace function public.revoke_sanction(p_channel uuid, p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
  b record;
  m public.moderation;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x where x.id = p_id and x.channel_id = p_channel and x.revoked_at is null;
  if not found then perform private.fail('request.invalid'); end if;

  update public.moderation x set revoked_at = now() where x.id = p_id;
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'revoke_sanction', m.kick_username,
    jsonb_build_object('kind', m.kind),
    jsonb_build_object('players', v_players, 'moderation', jsonb_build_array(to_jsonb(m))),
    p_request_id, private.moderation_rows(p_channel, array[p_id], array[m.kick_username]));
end $$;

create or replace function public.delete_sanction(p_channel uuid, p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
  b record;
  m public.moderation;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x where x.id = p_id and x.channel_id = p_channel;
  if not found then perform private.fail('request.invalid'); end if;

  delete from public.moderation x where x.id = p_id;
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'delete_sanction', m.kick_username,
    jsonb_build_object('kind', m.kind),
    jsonb_build_object('players', v_players, 'moderation', jsonb_build_array(to_jsonb(m))),
    p_request_id, private.moderation_rows(p_channel, array[p_id], array[m.kick_username]));
end $$;

-- Clearing the history ends every punishment, so Punished empties back into waiting.
create or replace function public.clear_moderation(p_channel uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
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
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'clear_moderation', null,
    jsonb_build_object('n', cardinality(v_ids)), jsonb_build_object('players', v_players, 'moderation', v_rows),
    p_request_id, private.moderation_rows(p_channel, v_ids, v_names));
end $$;

-- A punished player's away command does nothing (it used to flip any non-playing status).
create or replace function public.ingest_chat(p_broadcaster bigint, p_message_id text, p_command text, p_riot_id text,
  p_sender_id bigint, p_sender_name text, p_badges text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l        record;
  s        public.settings;
  p        public.players;
  v_reason text;
  v_puuid  text;
  v_n      integer;
  v_ev     jsonb;
  v_chan   jsonb;
begin
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
      perform private.join_check(l.channel_id, p_sender_name, p_sender_id, p_riot_id);
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
    where x.channel_id = l.channel_id and x.deleted_at is null and x.status = 'waiting' and x.joined_at <= p.joined_at;
    return jsonb_build_object('result', 'position', 'position', v_n);
  end if;

  -- perk: uses left in the rolling window.
  select count(*) into v_n from public.perk_uses u
  where u.channel_id = l.channel_id and u.kick_user_id = p_sender_id and u.refunded_at is null
    and u.used_at > now() - make_interval(days => s.perk_window_days);
  return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'left', greatest(s.perk_uses - v_n, 0));
end $$;
