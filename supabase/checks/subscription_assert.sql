-- 0049 assertions (subscription refill, spec 2026-10-18 § 4, S1–S7, rewritten 2026-10-19). Local
-- stack only: `bun run supabase:check supabase/checks/subscription_assert.sql`. Raises on the first
-- failure; the last select returns 'subscription ok'.

-- Each pick is stamped with clock_timestamp() so the next one sees it as the latest (as
-- protection_assert).
create function pg_temp.pick(p_ch uuid, p_n integer, p_src text, p_again boolean = false)
returns jsonb language plpgsql as $$
declare
  r jsonb;
  d uuid;
begin
  r := public.pick_players(p_ch, p_n, p_src,
    (select x.id from public.draws x where x.channel_id = p_ch and x.undone_at is null order by x.created_at desc limit 1),
    gen_random_uuid(), p_again);
  select (e ->> 'id')::uuid into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  update public.draws x set created_at = clock_timestamp() where x.id = d;
  return (select x.result from public.draws x where x.id = d);
end $$;

create function pg_temp.sub(p_msg text, p_kind text, p_ids bigint[], p_names text[],
  p_exp timestamptz = now() + interval '30 days', p_gifter bigint = null, p_gname text = null)
returns jsonb language sql as $$
  select public.ingest_subscription(-349, p_msg, p_kind, p_ids, p_names, p_exp, p_gifter, p_gname)
$$;

-- Fixture: channel qa-subs (broadcaster -349), owner qa_owner; perk on, 2 uses per 30 days for
-- subscribers; subscribers only may join. t01..t04 on teams, w01 waiting, none with a badge.
-- t01..t03, t04 and w01 have spent both uses yesterday; r01 (not in the queue) spent one.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000049', -149, 'qa_owner');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000049', -349, 'qa-subs', 'qa subs');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000049', -149, 'owner', 'owner');
insert into public.settings (channel_id, team_size, perk_enabled, perk_uses, perk_window_days, perk_badges,
                             join_subs_only, join_badges)
  values ('c0000000-0000-4000-8000-000000000049', 5, true, 2, 30, '{subscriber}', true, '{subscriber}');
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at, status, team)
  select 'c0000000-0000-4000-8000-000000000049', -4900 - i, 't' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 100 - i), 'playing', (1 + i % 2)::smallint
  from generate_series(1, 4) i;
insert into public.players (channel_id, kick_user_id, kick_username, source)
  values ('c0000000-0000-4000-8000-000000000049', -4911, 'w01', 'chat');
insert into public.perk_uses (channel_id, kick_user_id, used_at)
  select 'c0000000-0000-4000-8000-000000000049', u, now() - interval '1 day'
  from unnest(array[-4901, -4902, -4903, -4904, -4911, -4901, -4902, -4903, -4904, -4911, -4930]::bigint[]) u;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000049","role":"authenticated"}', true);

do $$
declare
  ch constant uuid := 'c0000000-0000-4000-8000-000000000049';
  r  jsonb;
  n  integer;
  t  timestamptz;
begin
  if private.perk_left(ch, -4901) <> 0 then raise exception 'fixture: t01 should have no uses left'; end if;

  -- 1. A gift to t01..t03 from w01 (S6): all four are full again; giftees are subscribers on
  --    their rows, the gifter is not; every refilled player in the queue is in the reply.
  r := pg_temp.sub('qa-sub-1', 'gift', array[-4901, -4902, -4903], array['t01', 't02', 't03'], p_gifter => -4911, p_gname => 'w01');
  if (select count(*) from unnest(array[-4901, -4902, -4903, -4911]::bigint[]) u where private.perk_left(ch, u) = 2) <> 4 then
    raise exception 'case 1: gifter and giftees not all full: %', r;
  end if;
  if (select count(*) from public.players where channel_id = ch and is_subscriber) <> 3
     or (select is_subscriber from public.players where channel_id = ch and kick_user_id = -4911) then
    raise exception 'case 1: is_subscriber wrong after the gift';
  end if;
  if (select expires_at from public.subscriptions where channel_id = ch and kick_user_id = -4911) is not null then
    raise exception 'case 1: the gifter got an expires_at';
  end if;
  -- w01 has no badge and no sub, so the perk is not theirs and no line names them.
  if jsonb_array_length(r -> 'refilled') <> 3
     or exists (select 1 from jsonb_array_elements(r -> 'refilled') e where (e ->> 'left')::int <> 2) then
    raise exception 'case 1: reply should name the three giftees with 2 left: %', r;
  end if;

  -- 2. An anonymous gift to t04: t04 is full, and no gifter row appears.
  n := (select count(*) from public.subscriptions where channel_id = ch);
  r := pg_temp.sub('qa-sub-2', 'gift', array[-4904], array['t04']);
  if private.perk_left(ch, -4904) <> 2 or (select count(*) from public.subscriptions where channel_id = ch) <> n + 1 then
    raise exception 'case 2: anonymous gift: %', r;
  end if;

  -- 3. A renewal with refill on gifts only: recorded, not refilled. An earlier expiry never
  --    shortens a later one.
  r := pg_temp.sub('qa-sub-3', 'renewal', array[-4930], array['r01'], now() + interval '20 days');
  if private.perk_left(ch, -4930) <> 1
     or (select expires_at from public.subscriptions where channel_id = ch and kick_user_id = -4930) <> now() + interval '20 days'
     or jsonb_array_length(r -> 'refilled') <> 0 then
    raise exception 'case 3: renewal refilled or not recorded: %', r;
  end if;
  perform pg_temp.sub('qa-sub-3b', 'renewal', array[-4901], array['t01'], now() + interval '10 days');
  if (select expires_at from public.subscriptions where channel_id = ch and kick_user_id = -4901) <> now() + interval '30 days' then
    raise exception 'case 3: an earlier expiry shortened a later one';
  end if;

  -- 5. A gifter-only row never counts as a subscriber.
  if private.badges(ch, -4911, '{}') <> '{}' then raise exception 'case 5: gifter-only row counts as a sub'; end if;
  if private.badges(ch, -4901, '{vip}') <> '{vip,subscriber}' or private.badges(ch, -4901, '{subscriber}') <> '{subscriber}' then
    raise exception 'case 5: badges for a recorded sub';
  end if;

  -- 6. A message seen twice writes nothing the second time.
  update public.perk_uses set used_at = now() - interval '1 hour' where channel_id = ch and kick_user_id = -4930;
  r := pg_temp.sub('qa-sub-3', 'gift', array[-4930], array['r01']);
  if r ->> 'result' <> 'duplicate' or private.perk_left(ch, -4930) <> 1 then raise exception 'case 6: replay wrote: %', r; end if;

  -- 7. Bad input: rejected before any write.
  n := (select count(*) from public.subscriptions where channel_id = ch);
  for r in select x from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('k', 'gift', 'ids', (select jsonb_agg(-5000 - i) from generate_series(1, 101) i), 'names', (select jsonb_agg('u' || i) from generate_series(1, 101) i)),
      jsonb_build_object('k', 'gift', 'ids', jsonb_build_array(-5001, -5002), 'names', jsonb_build_array('u1')),
      jsonb_build_object('k', 'follow', 'ids', jsonb_build_array(-5001), 'names', jsonb_build_array('u1')),
      jsonb_build_object('k', 'new', 'ids', jsonb_build_array(-5001), 'names', jsonb_build_array('u1'), 'exp', now() + interval '2 years'),
      jsonb_build_object('k', 'renewal', 'ids', jsonb_build_array(-5001), 'names', jsonb_build_array('u1'), 'g', -5009, 'gn', 'g1'),
      jsonb_build_object('k', 'gift', 'ids', jsonb_build_array(-5001), 'names', jsonb_build_array('u1'), 'g', -5009),
      jsonb_build_object('k', 'gift', 'ids', jsonb_build_array(-5001), 'names', jsonb_build_array('two words')),
      jsonb_build_object('k', 'gift', 'ids', jsonb_build_array(null), 'names', jsonb_build_array('u1'))
    )) x loop
    begin
      perform pg_temp.sub('qa-sub-bad', r ->> 'k',
        array(select jsonb_array_elements_text(r -> 'ids')::bigint), array(select jsonb_array_elements_text(r -> 'names')),
        coalesce((r ->> 'exp')::timestamptz, now() + interval '30 days'), (r ->> 'g')::bigint, r ->> 'gn');
      raise exception 'case 7: accepted %', r;
    exception when sqlstate 'P0001' then
      if sqlerrm like 'case 7%' then raise; end if;
    end;
  end loop;
  if (select count(*) from public.subscriptions where channel_id = ch) <> n
     or exists (select 1 from public.webhook_events where message_id = 'qa-sub-bad') then
    raise exception 'case 7: bad input wrote a row';
  end if;
  if public.ingest_subscription(-9999, 'qa-sub-ghost', 'gift', array[-4901], array['t01'], now() + interval '1 day') is not null then
    raise exception 'case 7: unknown broadcaster answered';
  end if;

  -- 9. !perk with no badge answers from the recorded sub, and left = perk_left.
  for n in select u from unnest(array[-4901, -4930]::bigint[]) u loop
    r := public.ingest_chat(-349, 'qa-sub-perk' || n, 'perk', null, n, 'p' || abs(n), '{}');
    if not (r ->> 'eligible')::boolean or (r ->> 'left')::int <> private.perk_left(ch, n) then
      raise exception 'case 9: !perk for % = %, perk_left %', n, r, private.perk_left(ch, n);
    end if;
  end loop;
  r := public.ingest_chat(-349, 'qa-sub-perk-w01', 'perk', null, -4911, 'w01', '{}');
  if (r ->> 'eligible')::boolean then raise exception 'case 9: gifter-only !perk eligible: %', r; end if;

  -- 4. A recorded sub with no badge: protected in Pick from Teams, through the subs-only gate,
  --    joins as a subscriber; not through a gate for VIPs only; none of it once expired.
  r := pg_temp.pick(ch, 4, 'teams');
  if jsonb_array_length(r -> 'saved') <> 4 then raise exception 'case 4: badge-less subs not protected: %', r; end if;
  r := public.ingest_chat(-349, 'qa-sub-j1', 'join', null, -4940, 'g40', '{}');
  if r ->> 'reason' <> 'queue.badge' then raise exception 'case 4: no sub let in: %', r; end if;
  perform pg_temp.sub('qa-sub-j2', 'new', array[-4941, -4942, -4943], array['g41', 'g42', 'g43']);
  r := public.ingest_chat(-349, 'qa-sub-j3', 'join', null, -4941, 'g41', '{}');
  if r ->> 'result' <> 'joined' or not (select is_subscriber from public.players where id = (r ->> 'player')::uuid) then
    raise exception 'case 4: recorded sub turned away or not marked: %', r;
  end if;
  update public.settings set join_badges = '{vip}' where channel_id = ch;
  r := public.ingest_chat(-349, 'qa-sub-j4', 'join', null, -4942, 'g42', '{}');
  if r ->> 'reason' <> 'queue.badge' then raise exception 'case 4: VIP-only gate let a sub in: %', r; end if;
  update public.settings set join_badges = '{subscriber}' where channel_id = ch;
  update public.subscriptions set expires_at = now() - interval '1 second' where channel_id = ch;
  r := public.ingest_chat(-349, 'qa-sub-j5', 'join', null, -4943, 'g43', '{}');
  if r ->> 'reason' <> 'queue.badge' then raise exception 'case 4: expired sub let in: %', r; end if;
  r := pg_temp.pick(ch, 4, 'teams', true);
  if jsonb_array_length(r -> 'saved') <> 0 then raise exception 'case 4: expired subs still protected: %', r; end if;

  -- 8. Server-only.
  if has_function_privilege('anon', 'public.ingest_subscription(bigint, text, text, bigint[], text[], timestamptz, bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public.ingest_subscription(bigint, text, text, bigint[], text[], timestamptz, bigint, text)', 'execute')
     or not has_function_privilege('service_role', 'public.ingest_subscription(bigint, text, text, bigint[], text[], timestamptz, bigint, text)', 'execute')
     or has_table_privilege('anon', 'public.subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.subscriptions', 'select')
     or has_function_privilege('authenticated', 'private.badges(uuid, bigint, text[])', 'execute') then
    raise exception 'case 8: grants';
  end if;

  -- 10. One check: every reader of a badge list goes through private.badges.
  if (select count(*) from pg_proc where oid in ('public.ingest_chat'::regproc, 'public.pick_players'::regproc)
        and prosrc ~ 'private\.badges\(') <> 2 then
    raise exception 'case 10: a reader skips private.badges';
  end if;
end $$;

select 'subscription ok' as result;
