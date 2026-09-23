-- Retention check. Run the whole file with execute_sql: backdated fixtures on either side of
-- every rule, one private.retention(), then assertions; it ends in rollback.
begin;

insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000009', -901, 'qa-retention', 'qa');
insert into public.settings (channel_id, perk_window_days) values ('c0000000-0000-4000-8000-000000000009', 30);
insert into public.channel_members (channel_id, kick_user_id, role, source, last_seen_at) values
  ('c0000000-0000-4000-8000-000000000009', -901, 'owner', 'owner', null),
  ('c0000000-0000-4000-8000-000000000009', -902, 'mod', 'badge', now() - interval '31 days'),
  ('c0000000-0000-4000-8000-000000000009', -903, 'mod', 'badge', now() - interval '29 days'),
  ('c0000000-0000-4000-8000-000000000009', -904, 'mod', 'manual', now() - interval '90 days');
insert into public.players (channel_id, kick_username, source, deleted_at) values
  ('c0000000-0000-4000-8000-000000000009', 'gone', 'manual', now() - interval '11 minutes'),
  ('c0000000-0000-4000-8000-000000000009', 'undoable', 'manual', now() - interval '5 minutes'),
  ('c0000000-0000-4000-8000-000000000009', 'live', 'manual', null);
insert into public.draws (channel_id, kind, n, result, request_id, created_at, undone_at) values
  ('c0000000-0000-4000-8000-000000000009', 'pick', 1, '{"tag":"old"}', gen_random_uuid(), now() - interval '26 hours', null),
  ('c0000000-0000-4000-8000-000000000009', 'pick', 1, '{"tag":"standing"}', gen_random_uuid(), now() - interval '25 hours', null),
  ('c0000000-0000-4000-8000-000000000009', 'pick', 1, '{"tag":"undone"}', gen_random_uuid(), now() - interval '24 hours 30 minutes', now());
insert into public.activity (channel_id, v, action, undo, created_at) values
  ('c0000000-0000-4000-8000-000000000009', 1, 'old', null, now() - interval '31 days'),
  ('c0000000-0000-4000-8000-000000000009', 2, 'stale_undo', '{"players":[]}', now() - interval '20 minutes'),
  ('c0000000-0000-4000-8000-000000000009', 3, 'fresh_undo', '{"players":[]}', now() - interval '5 minutes');
insert into public.webhook_events (message_id, received_at) values
  ('qa-old', now() - interval '2 hours'), ('qa-new', now() - interval '10 minutes');
insert into public.perk_uses (channel_id, kick_user_id, used_at) values
  ('c0000000-0000-4000-8000-000000000009', -950, now() - interval '32 days'),
  ('c0000000-0000-4000-8000-000000000009', -951, now() - interval '20 days');
insert into public.riot_cache (puuid, game_name, tag_line, fetched_at) values
  ('qa-old', 'Old', 'TR1', now() - interval '8 days'), ('qa-new', 'New', 'TR1', now() - interval '1 day');

select private.retention();

do $$
declare
  ch constant uuid := 'c0000000-0000-4000-8000-000000000009';
begin
  if (select array_agg(kick_username order by kick_username) from public.players where channel_id = ch) <> array['live', 'undoable'] then
    raise exception 'players: soft-deleted rule wrong';
  end if;
  if (select array_agg(result ->> 'tag') from public.draws where channel_id = ch) <> array['standing'] then
    raise exception 'draws: expected only the standing draw';
  end if;
  if (select array_agg(action order by v) from public.activity where channel_id = ch) <> array['stale_undo', 'fresh_undo']
     or (select undo from public.activity where channel_id = ch and action = 'stale_undo') is not null
     or (select undo from public.activity where channel_id = ch and action = 'fresh_undo') is null then
    raise exception 'activity: 30-day or 10-minute undo rule wrong';
  end if;
  if exists (select 1 from public.webhook_events where message_id = 'qa-old')
     or not exists (select 1 from public.webhook_events where message_id = 'qa-new') then
    raise exception 'webhook_events: 1-hour rule wrong';
  end if;
  if (select array_agg(kick_user_id) from public.perk_uses where channel_id = ch) <> array[-951::bigint] then
    raise exception 'perk_uses: window + 1 day rule wrong';
  end if;
  if (select array_agg(kick_user_id order by kick_user_id desc) from public.channel_members where channel_id = ch)
     <> array[-901, -903, -904]::bigint[] then
    raise exception 'channel_members: badge 30-day rule wrong';
  end if;
  if exists (select 1 from public.riot_cache where puuid = 'qa-old')
     or not exists (select 1 from public.riot_cache where puuid = 'qa-new') then
    raise exception 'riot_cache: 7-day rule wrong';
  end if;
  if not exists (select 1 from cron.job where jobname = 'queue-retention' and schedule = '*/5 * * * *' and active) then
    raise exception 'cron: queue-retention not scheduled';
  end if;
end $$;

select 'retention ok' as result;
rollback;
