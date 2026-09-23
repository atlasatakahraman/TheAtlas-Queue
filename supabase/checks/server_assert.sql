-- Server RPC check (Stage 3). Run the whole file with execute_sql; it ends in rollback.
begin;

insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-00000000000a', -1001, 'qa-server', 'qa');
insert into public.settings (channel_id) values ('c0000000-0000-4000-8000-00000000000a');
insert into public.channel_members (channel_id, kick_user_id, kick_username, role, source, blocked, last_seen_at) values
  ('c0000000-0000-4000-8000-00000000000a', -1001, 'qa_owner', 'owner', 'owner', false, null),
  ('c0000000-0000-4000-8000-00000000000a', -1002, 'man_mod', 'mod', 'manual', false, null),
  ('c0000000-0000-4000-8000-00000000000a', -1003, 'badge_mod', 'mod', 'badge', false, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-00000000000a', -1004, 'blocked_mod', 'mod', 'badge', true, now() - interval '2 days');
insert into public.riot_cache (puuid, game_name, tag_line, tier, fetched_at) values
  ('qa-cached', 'Cached Guy', 'TR1', 'GOLD', now() - interval '1 hour'),
  ('qa-stale', 'Stale One', 'TR1', 'SILVER', now() - interval '7 hours');
insert into public.moderation (channel_id, kick_username, kind) values ('c0000000-0000-4000-8000-00000000000a', 'banned1', 'ban');

do $$
declare
  ch constant uuid := 'c0000000-0000-4000-8000-00000000000a';
  r  jsonb;
  v0 bigint;
  n  integer;
  ctx jsonb;
begin
  -- Each RPC call is its own statement: a statement that calls one and then reads the table
  -- sees the snapshot from before the call.
  -- Context
  ctx := public.webhook_context(-1001);
  if ctx ->> 'channel_id' <> ch::text or ctx #>> '{commands,join}' <> '!sıra' or ctx ->> 'riot' <> 'tr1'
     or (select count(*) from jsonb_object_keys(ctx -> 'members')) <> 4
     or ctx #>> '{members,-1004,blocked}' <> 'true' then
    raise exception 'webhook_context wrong: %', ctx;
  end if;
  if public.webhook_context(-9999) is not null then raise exception 'unknown broadcaster has a context'; end if;

  -- Join with a fresh cached rank
  select version into v0 from public.channels where id = ch;
  r := public.ingest_chat(-1001, 'qa-m1', 'join', 'Cached Guy#TR1', -2001, 'viewer1', array['subscriber', 'og']);
  if r ->> 'result' <> 'joined' or (r ->> 'rank_needed')::boolean then raise exception 'join: %', r; end if;
  if not exists (select 1 from public.players where channel_id = ch and kick_user_id = -2001 and puuid = 'qa-cached'
                 and is_subscriber and source = 'chat' and badges = array['subscriber', 'og'] and changed_by is null) then
    raise exception 'join: row wrong';
  end if;
  if not exists (select 1 from public.activity where channel_id = ch and action = 'chat_join' and actor is null and target = 'viewer1')
     or (select version from public.channels where id = ch) <> v0 + 1
     or (select last_command_at from public.channels where id = ch) is null then
    raise exception 'join: activity/version/last_command_at wrong';
  end if;

  -- Redelivery of the same Kick message
  r := public.ingest_chat(-1001, 'qa-m1', 'join', 'Cached Guy#TR1', -2001, 'viewer1', '{}');
  if r ->> 'result' <> 'duplicate' or (select count(*) from public.players where channel_id = ch) <> 1 then
    raise exception 'dedupe: %', r;
  end if;

  -- Cooldown: silent
  select count(*) into n from public.activity where channel_id = ch;
  r := public.ingest_chat(-1001, 'qa-m2', 'join', null, -2001, 'viewer1', '{}');
  if r ->> 'reason' <> 'queue.cooldown' or (select count(*) from public.activity where channel_id = ch) <> n then
    raise exception 'cooldown: %', r;
  end if;

  -- After the cooldown the duplicate is a visible rejection
  update public.activity set created_at = now() - interval '11 seconds' where channel_id = ch;
  r := public.ingest_chat(-1001, 'qa-m3', 'join', null, -2001, 'viewer1', '{}');
  if r ->> 'result' <> 'rejected' or r ->> 'reason' <> 'queue.duplicate'
     or not exists (select 1 from public.activity where channel_id = ch and action = 'chat_rejected'
                    and payload ->> 'reason' = 'queue.duplicate') then
    raise exception 'duplicate: %', r;
  end if;

  -- Stale cache → Riot lookup needed; no Riot ID → none needed
  r := public.ingest_chat(-1001, 'qa-m4', 'join', 'Stale One#TR1', -2002, 'viewer2', '{}');
  if r ->> 'result' <> 'joined' or not (r ->> 'rank_needed')::boolean then raise exception 'stale: %', r; end if;
  r := public.ingest_chat(-1001, 'qa-m5', 'join', null, -2003, 'viewer3', '{}');
  if r ->> 'result' <> 'joined' or (r ->> 'rank_needed')::boolean then raise exception 'no riot: %', r; end if;

  -- Require Riot ID, and a ban
  update public.settings set require_riot_id = true where channel_id = ch;
  r := public.ingest_chat(-1001, 'qa-m6', 'join', null, -2004, 'viewer4', '{}');
  if r ->> 'reason' <> 'queue.riot_required' then raise exception 'riot required: %', r; end if;
  update public.settings set require_riot_id = false where channel_id = ch;
  r := public.ingest_chat(-1001, 'qa-m7', 'join', null, -2005, 'banned1', '{}');
  if r ->> 'reason' <> 'queue.banned' then raise exception 'banned: %', r; end if;

  -- Away toggles; position and perk answer without an event
  r := public.ingest_chat(-1001, 'qa-m8', 'away', null, -2003, 'viewer3', '{}');
  if r ->> 'status' <> 'away' then raise exception 'away 1: %', r; end if;
  r := public.ingest_chat(-1001, 'qa-m9', 'away', null, -2003, 'viewer3', '{}');
  if r ->> 'status' <> 'waiting' then raise exception 'away 2: %', r; end if;
  select version into v0 from public.channels where id = ch;
  r := public.ingest_chat(-1001, 'qa-m10', 'position', null, -2003, 'viewer3', '{}');
  if (r ->> 'position')::int <> 3 then raise exception 'position: %', r; end if;
  r := public.ingest_chat(-1001, 'qa-m11', 'perk', null, -2001, 'viewer1', '{}');
  if (r ->> 'left')::int <> 3 or (r ->> 'enabled')::boolean then raise exception 'perk: %', r; end if;
  if (select version from public.channels where id = ch) <> v0 then raise exception 'position/perk emitted'; end if;

  -- Leave
  r := public.ingest_chat(-1001, 'qa-m12', 'leave', null, -2003, 'viewer3', '{}');
  if r ->> 'result' <> 'left' or not exists (select 1 from public.players where kick_user_id = -2003 and deleted_at is not null) then
    raise exception 'leave: %', r;
  end if;
  r := public.ingest_chat(-1001, 'qa-m13', 'leave', null, -2003, 'viewer3', '{}');
  if r ->> 'result' <> 'none' then raise exception 'leave twice: %', r; end if;

  -- Unknown channel: nothing written
  r := public.ingest_chat(-9999, 'qa-m14', 'join', null, -2006, 'ghost', '{}');
  if r is not null
     or exists (select 1 from public.webhook_events where message_id = 'qa-m14') then
    raise exception 'unknown channel wrote something';
  end if;
  begin
    perform public.ingest_chat(-1001, 'qa-m15', 'dance', null, -2006, 'ghost', '{}');
    raise exception 'bad command accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'request.invalid' then raise; end if;
  end;

  -- Rank lands without touching changed_v
  select changed_v into v0 from public.players where kick_user_id = -2002;
  r := public.set_riot_rank(ch, 'stale one#tr1', 'qa-new', 'Stale One', 'TR1', 'GOLD', 'II', 50, 7);
  if (r ->> 'players')::int <> 1 or (select puuid from public.players where kick_user_id = -2002) <> 'qa-new'
     or (select changed_v from public.players where kick_user_id = -2002) <> v0
     or (select tier from public.riot_cache where puuid = 'qa-new') <> 'GOLD' then
    raise exception 'rank: %', r;
  end if;

  -- Badge sync
  r := public.sync_member_badge(-1001, -2010, 'newmod', true);
  if not (r ->> 'changed')::boolean
     or not exists (select 1 from public.channel_members where channel_id = ch and kick_user_id = -2010 and source = 'badge' and role = 'mod') then
    raise exception 'badge grant';
  end if;
  select version into v0 from public.channels where id = ch;
  r := public.sync_member_badge(-1001, -1003, 'badge_mod', true);
  if (r ->> 'changed')::boolean
     or (select last_seen_at from public.channel_members where kick_user_id = -1003) < now() - interval '1 minute'
     or (select version from public.channels where id = ch) <> v0 then
    raise exception 'badge refresh';
  end if;
  perform public.sync_member_badge(-1001, -1003, 'badge_mod', false);
  perform public.sync_member_badge(-1001, -1004, 'blocked_mod', false);
  perform public.sync_member_badge(-1001, -1002, 'man_mod', false);
  perform public.sync_member_badge(-1001, -1004, 'blocked_mod', true);
  perform public.sync_member_badge(-1001, -1001, 'qa_owner', false);
  if (select array_agg(kick_user_id order by kick_user_id desc) from public.channel_members where channel_id = ch)
     <> array[-1001, -1002, -1004, -2010]::bigint[]
     or not (select blocked from public.channel_members where kick_user_id = -1004) then
    raise exception 'badge revoke/block/manual/owner';
  end if;

  -- Live resets games_played once; offline clears
  update public.players set games_played = 3 where kick_user_id = -2001;
  select changed_v into v0 from public.players where kick_user_id = -2001;
  r := public.set_live(-1001, true, '2026-09-23 18:00+00');
  if not (r ->> 'changed')::boolean
     or (select games_played from public.players where kick_user_id = -2001) <> 0
     or (select changed_v from public.players where kick_user_id = -2001) <> v0
     or (select live_since from public.channels where id = ch) <> '2026-09-23 18:00+00' then
    raise exception 'live';
  end if;
  if (public.set_live(-1001, true, '2026-09-23 18:00+00') ->> 'changed')::boolean then raise exception 'live repeat'; end if;
  perform public.set_live(-1001, false, null);
  if (select live_since from public.channels where id = ch) is not null then raise exception 'offline'; end if;
  if public.set_live(-9999, true, now()) is not null then raise exception 'live unknown'; end if;

  -- Onboarding, twice
  r := public.onboard_channel(-1100, 'NewStreamer', 'NewStreamer');
  if not (r ->> 'created')::boolean or r ->> 'slug' <> 'newstreamer'
     or not exists (select 1 from public.channel_members where kick_user_id = -1100 and role = 'owner')
     or not exists (select 1 from public.settings where channel_id = (r ->> 'channel_id')::uuid) then
    raise exception 'onboard: %', r;
  end if;
  r := public.onboard_channel(-1100, 'NewStreamer', 'newstreamer');
  if (r ->> 'created')::boolean
     or (select count(*) from public.channels where kick_channel_id = -1100) <> 1 then
    raise exception 'onboard twice';
  end if;
  begin
    perform public.onboard_channel(-1101, 'Other', 'newstreamer');
    raise exception 'slug clash accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'request.invalid' then raise; end if;
  end;

  -- Subscription state emits only on change
  select version into v0 from public.channels where id = ch;
  perform public.set_subscription_state(ch, 'kick 500');
  perform public.set_subscription_state(ch, 'kick 500');
  if (select version from public.channels where id = ch) <> v0 + 1 then raise exception 'subscription error emit'; end if;
  perform public.set_subscription_state(ch, null);
  if (select subscription_error is null and subscriptions_ok_at is not null from public.channels where id = ch) is not true then
    raise exception 'subscription ok';
  end if;

  -- Only the server may call these
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('webhook_context', 'ingest_chat', 'sync_member_badge', 'set_live', 'set_riot_rank',
                      'onboard_channel', 'set_subscription_state')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and has_function_privilege('service_role', p.oid, 'execute');
  if n <> 7 then raise exception 'server RPC grants: % of 7 correct', n; end if;
end $$;

-- service_role (the secret key) can call them through the API role.
set local role service_role;
select case when public.webhook_context(-1001) is not null then 'server ok' end as result;
rollback;
