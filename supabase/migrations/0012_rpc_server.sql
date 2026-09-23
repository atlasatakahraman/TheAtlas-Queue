-- Server RPCs: the Kick webhook, onboarding and the health check call these with the secret key
-- (service_role). Contracts: vault stages/2026-09-23-queue-rewrite-stage-3.md. An unknown Kick
-- broadcaster (never onboarded, or mid-deletion) returns null and writes nothing.

-- Lock a channel by its Kick broadcaster id; the version the next write produces.
create function private.lock_broadcaster(p_broadcaster bigint, out channel_id uuid, out next_v bigint)
language sql set search_path = '' as $$
  select c.id, c.version + 1 from public.channels c where c.kick_channel_id = p_broadcaster for update
$$;
revoke execute on function private.lock_broadcaster(bigint) from public, anon, authenticated;

-- What the webhook needs to route a chat line without asking Postgres again for 60 s.
create function public.webhook_context(p_broadcaster bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channel_id', c.id,
    'commands', jsonb_build_object('join', s.join_command, 'leave', s.leave_command,
      'position', s.position_command, 'perk', s.perk_command, 'away', s.away_command),
    'riot', case when s.riot_enabled then s.riot_region end,
    'members', coalesce((select jsonb_object_agg(m.kick_user_id::text,
        jsonb_build_object('source', m.source, 'blocked', m.blocked, 'seen', m.last_seen_at))
      from public.channel_members m where m.channel_id = c.id), '{}'::jsonb))
  from public.channels c join public.settings s on s.channel_id = c.id
  where c.kick_channel_id = p_broadcaster
$$;

-- One chat command (the webhook has matched it against the channel's commands). Deduped by
-- Kick message id in the same transaction, so a failed write can be redelivered.
create function public.ingest_chat(p_broadcaster bigint, p_message_id text, p_command text, p_riot_id text,
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
    if p.id is null or p.status = 'playing' then return jsonb_build_object('result', 'none'); end if;
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

-- A moderator badge grants a badge membership (or refreshes last_seen_at); no badge revokes a
-- badge membership. A block and a manual membership are never changed from chat (spec D8).
create function public.sync_member_badge(p_broadcaster bigint, p_user_id bigint, p_username text, p_is_mod boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l   record;
  m   public.channel_members;
  v_r jsonb;
begin
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  if p_username !~ '^\S{1,40}$' then perform private.fail('request.invalid'); end if;
  select * into m from public.channel_members x where x.channel_id = l.channel_id and x.kick_user_id = p_user_id;

  if p_is_mod and m.kick_user_id is null then
    insert into public.channel_members (channel_id, kick_user_id, kick_username, role, source, last_seen_at)
    values (l.channel_id, p_user_id, p_username, 'mod', 'badge', now()) returning * into m;
    v_r := to_jsonb(m) || '{"_t":"channel_members"}'::jsonb;
  elsif p_is_mod and m.role = 'mod' then
    update public.channel_members x set last_seen_at = now(), kick_username = p_username
    where x.channel_id = l.channel_id and x.kick_user_id = p_user_id;
    if m.kick_username is distinct from p_username then
      v_r := to_jsonb(m) || jsonb_build_object('kick_username', p_username, 'last_seen_at', now(), '_t', 'channel_members');
    end if;
  elsif not p_is_mod and m.source = 'badge' and not m.blocked then
    delete from public.channel_members x where x.channel_id = l.channel_id and x.kick_user_id = p_user_id;
    v_r := jsonb_build_object('_t', 'channel_members', 'channel_id', l.channel_id, 'kick_user_id', p_user_id, '_deleted', true);
  end if;

  if v_r is null then return jsonb_build_object('changed', false); end if;
  perform private.commit(l.channel_id, l.next_v, null, 'member_badge', p_username,
    jsonb_build_object('kick_user_id', p_user_id, 'granted', p_is_mod), null, null, jsonb_build_array(v_r));
  return jsonb_build_object('changed', true);
end $$;

-- livestream.status.updated. Going live starts a new fair-play window (spec D10). The reset is
-- not a user edit, so changed_v stays and no pending undo breaks.
create function public.set_live(p_broadcaster bigint, p_live boolean, p_started_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l      record;
  v_was  timestamptz;
  v_rows jsonb;
begin
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  select c.live_since into v_was from public.channels c where c.id = l.channel_id;
  p_started_at := case when p_live then coalesce(p_started_at, now()) end;
  if v_was is not distinct from p_started_at then return jsonb_build_object('changed', false); end if;

  update public.channels c set live_since = p_started_at where c.id = l.channel_id;
  v_rows := jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', l.channel_id, 'live_since', p_started_at));
  if p_live then
    with r as (
      update public.players x set games_played = 0
      where x.channel_id = l.channel_id and x.deleted_at is null and x.games_played > 0
      returning x.*)
    select v_rows || coalesce(jsonb_agg(private.player_json(r::public.players)), '[]'::jsonb) into v_rows from r;
  end if;
  perform private.commit(l.channel_id, l.next_v, null, case when p_live then 'stream_live' else 'stream_offline' end,
    null, '{}'::jsonb, null, null, v_rows);
  return jsonb_build_object('changed', true);
end $$;

-- A Riot lookup finished (webhook after()). Fills the shared cache and every live row with that
-- Riot ID still missing it. Not a feed item and not a user edit: no activity, changed_v stays.
create function public.set_riot_rank(p_channel uuid, p_riot_id text, p_puuid text, p_game_name text,
  p_tag_line text, p_tier text, p_division text, p_lp integer, p_icon integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  insert into public.riot_cache (puuid, game_name, tag_line, tier, division, league_points, icon, fetched_at)
  values (p_puuid, p_game_name, p_tag_line, p_tier, p_division, p_lp, p_icon, now())
  on conflict (puuid) do update set game_name = excluded.game_name, tag_line = excluded.tag_line,
    tier = excluded.tier, division = excluded.division, league_points = excluded.league_points,
    icon = excluded.icon, fetched_at = now();
  with r as (
    update public.players x set puuid = p_puuid
    where x.channel_id = p_channel and x.deleted_at is null and lower(x.riot_id) = lower(p_riot_id)
      and x.puuid is distinct from p_puuid
    returning x.*)
  select jsonb_agg(private.player_json(r::public.players)) into v_rows from r;
  if v_rows is not null then perform private.emit(p_channel, 'rank', v_rows, null); end if;
  return jsonb_build_object('players', coalesce(jsonb_array_length(v_rows), 0));
end $$;

-- /welcome step 1. The caller (a server action) passes the signed-in user's own Kick id, so a
-- channel is only ever created by the Kick user who owns it. Safe to repeat.
create function public.onboard_channel(p_kick_user_id bigint, p_username text, p_slug text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id      uuid;
  v_created boolean;
begin
  p_slug := lower(p_slug);
  if p_kick_user_id is null or p_username !~ '^\S{1,40}$' or p_slug !~ '^[a-z0-9_-]{1,40}$' then
    perform private.fail('request.invalid');
  end if;
  insert into public.channels (kick_channel_id, slug, display_name)
  values (p_kick_user_id, p_slug, p_username)
  on conflict (kick_channel_id) do update set slug = excluded.slug, display_name = excluded.display_name
  returning id, (xmax = 0) into v_id, v_created;
  insert into public.channel_members (channel_id, kick_user_id, kick_username, role, source)
  values (v_id, p_kick_user_id, p_username, 'owner', 'owner')
  on conflict (channel_id, kick_user_id) do update set kick_username = excluded.kick_username;
  insert into public.settings (channel_id) values (v_id) on conflict do nothing;
  return jsonb_build_object('channel_id', v_id, 'slug', p_slug, 'created', v_created);
exception when unique_violation then
  -- Another channel row still holds this slug (a renamed Kick channel).
  perform private.fail('request.invalid', jsonb_build_object('field', 'slug'));
end $$;

-- Health check / onboarding result for one channel. Emits only when the error changes, so the
-- 10-minute check does not bump every channel's version.
create function public.set_subscription_state(p_channel uuid, p_error text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_was text;
  c     public.channels;
begin
  select x.subscription_error into v_was from public.channels x where x.id = p_channel for update;
  if not found then return null; end if;
  update public.channels x set
    subscriptions_ok_at = case when p_error is null then now() else x.subscriptions_ok_at end,
    subscription_error = left(p_error, 200)
  where x.id = p_channel returning * into c;
  if v_was is not distinct from c.subscription_error then return jsonb_build_object('changed', false); end if;
  perform private.emit(p_channel, 'subscriptions', jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', c.id,
    'subscriptions_ok_at', c.subscriptions_ok_at, 'subscription_error', c.subscription_error)), null);
  return jsonb_build_object('changed', true);
end $$;

revoke execute on function public.webhook_context(bigint) from public, anon, authenticated;
revoke execute on function public.ingest_chat(bigint, text, text, text, bigint, text, text[]) from public, anon, authenticated;
revoke execute on function public.sync_member_badge(bigint, bigint, text, boolean) from public, anon, authenticated;
revoke execute on function public.set_live(bigint, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.onboard_channel(bigint, text, text) from public, anon, authenticated;
revoke execute on function public.set_subscription_state(uuid, text) from public, anon, authenticated;
grant execute on function public.webhook_context(bigint) to service_role;
grant execute on function public.ingest_chat(bigint, text, text, text, bigint, text, text[]) to service_role;
grant execute on function public.sync_member_badge(bigint, bigint, text, boolean) to service_role;
grant execute on function public.set_live(bigint, boolean, timestamptz) to service_role;
grant execute on function public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer) to service_role;
grant execute on function public.onboard_channel(bigint, text, text) to service_role;
grant execute on function public.set_subscription_state(uuid, text) to service_role;

-- A block must outlive 30 quiet days, or a blocked moderator's badge would let them back in.
create or replace function private.retention() returns void
language sql set search_path = '' as $$
  delete from public.players where deleted_at < now() - interval '10 minutes';
  update public.activity set undo = null where undo is not null and created_at < now() - interval '10 minutes';
  delete from public.draws d
  where d.created_at < now() - interval '24 hours'
    and d.id is distinct from (select x.id from public.draws x
                               where x.channel_id = d.channel_id and x.undone_at is null
                               order by x.created_at desc limit 1);
  delete from public.activity where created_at < now() - interval '30 days';
  delete from public.webhook_events where received_at < now() - interval '1 hour';
  delete from public.perk_uses u using public.settings s
  where s.channel_id = u.channel_id and u.used_at < now() - make_interval(days => s.perk_window_days + 1);
  delete from public.channel_members
  where source = 'badge' and not blocked and coalesce(last_seen_at, created_at) < now() - interval '30 days';
  delete from public.riot_cache where fetched_at < now() - interval '7 days';
$$;
