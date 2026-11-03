-- 0050 + 0051 assertions (a gift protects its giver, not its receiver, unless ticked; spec
-- 2026-11-03 § 1, G1–G7, and § 1b, B1–B5: badges decide who, refill decides when). Local stack only: `bun run supabase:check supabase/checks/gift_assert.sql`. Raises
-- on the first failure; the last select returns 'gift ok'.

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
  p_gifter bigint = null, p_gname text = null)
returns jsonb language sql as $$
  select public.ingest_subscription(-350, p_msg, p_kind, p_ids, p_names, now() + interval '30 days', p_gifter, p_gname)
$$;

-- Fixture: channel qa-gifts (broadcaster -350), owner qa_gift_owner; perk on, 2 uses per 30 days
-- for subscribers, VIPs and sub gifters, refill left at its default; subscribers only may join. g01..g04 on
-- teams, w01 waiting, none with a badge, every use spent yesterday.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000050', -150, 'qa_gift_owner');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000050', -350, 'qa-gifts', 'qa gifts');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000050', -150, 'owner', 'owner');
insert into public.settings (channel_id, team_size, perk_enabled, perk_uses, perk_window_days, perk_badges,
                             join_subs_only, join_badges)
  values ('c0000000-0000-4000-8000-000000000050', 5, true, 2, 30, '{subscriber,vip,sub_gifter}', true, '{subscriber}');
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at, status, team)
  select 'c0000000-0000-4000-8000-000000000050', -5000 - i, 'g' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 100 - i), 'playing', (1 + i % 2)::smallint
  from generate_series(1, 4) i;
insert into public.players (channel_id, kick_user_id, kick_username, source)
  values ('c0000000-0000-4000-8000-000000000050', -5011, 'w01', 'chat');
insert into public.perk_uses (channel_id, kick_user_id, used_at)
  select 'c0000000-0000-4000-8000-000000000050', u, now() - interval '1 day'
  from unnest(array[-5001, -5002, -5003, -5004, -5011]::bigint[]) u, generate_series(1, 2);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000050","role":"authenticated"}', true);

do $$
declare
  ch constant uuid := 'c0000000-0000-4000-8000-000000000050';
  r  jsonb;
  n  integer;
begin
  if private.perk_left(ch, -5001) <> 0 then raise exception 'fixture: g01 should have no uses left'; end if;

  -- G1 / B1. The default refills on Gift, New sub and Renewal.
  if (select perk_refill_on from public.settings where channel_id = ch) <> '{gift,new,renewal}' then
    raise exception 'G1: default refill %', (select perk_refill_on from public.settings where channel_id = ch);
  end if;

  -- G2 / B1. w01 gifts g01 and g21 (not in the queue): everyone in the gift is refilled, but with
  --     Sub receiver unticked the receivers can't use it; they're still subscribers (Sub tag,
  --     subs-only gate) but not protected.
  r := pg_temp.sub('qa-gift-2', 'gift', array[-5001, -5021], array['g01', 'g21'], -5011, 'w01');
  if private.perk_left(ch, -5011) <> 2 or private.perk_left(ch, -5001) <> 2 then
    raise exception 'G2: giver % / receiver % uses left', private.perk_left(ch, -5011), private.perk_left(ch, -5001);
  end if;
  if not (select is_subscriber from public.players where channel_id = ch and kick_user_id = -5001) then
    raise exception 'G2: receiver lost the Sub tag';
  end if;
  if (select kind from public.subscriptions where channel_id = ch and kick_user_id = -5001) is distinct from 'gift'
     or (select gifted_at from public.subscriptions where channel_id = ch and kick_user_id = -5011) is null then
    raise exception 'G2: kind or gifted_at not recorded';
  end if;
  if private.perk_eligible(ch, -5001, '{subscriber}') or not private.perk_eligible(ch, -5011, '{}') then
    raise exception 'G2: eligibility (receiver must be out, giver in)';
  end if;
  if r ->> 'result' <> 'refilled' or jsonb_array_length(r -> 'refilled') <> 1
     or (r -> 'refilled' -> 0 ->> 'kick_user_id')::bigint <> -5011 then
    raise exception 'G2: reply should name the giver alone: %', r;
  end if;
  r := pg_temp.pick(ch, 4, 'teams');
  if exists (select 1 from jsonb_array_elements(r -> 'saved') e
             join public.players p on p.id = (e ->> 'id')::uuid where p.kick_user_id = -5001) then
    raise exception 'G2: the receiver was protected: %', r;
  end if;
  r := public.ingest_chat(-350, 'qa-gift-join', 'join', null, -5021, 'g21', '{}');
  if r ->> 'result' <> 'joined' then raise exception 'G2: receiver turned away at the subs-only gate: %', r; end if;
  r := public.ingest_chat(-350, 'qa-gift-perk', 'perk', null, -5021, 'g21', '{subscriber}');
  if (r ->> 'eligible')::boolean then raise exception 'G2: !perk eligible for a receiver: %', r; end if;

  -- B3. Sub gifter unticked: neither the recent gift nor Kick's chat sub_gifter badge counts.
  update public.settings set perk_badges = '{subscriber,vip}' where channel_id = ch;
  if private.perk_eligible(ch, -5011, '{}') or private.perk_eligible(ch, -5011, '{sub_gifter}') then
    raise exception 'B3: giver eligible with Sub gifter unticked';
  end if;
  update public.settings set perk_badges = '{subscriber,vip,sub_gifter}' where channel_id = ch;
  if not private.perk_eligible(ch, -5099, '{sub_gifter}') then raise exception 'B3: chat sub_gifter badge'; end if;

  -- G3. Perk off: the gift is still logged and the giver still recorded.
  update public.settings set perk_enabled = false where channel_id = ch;
  r := pg_temp.sub('qa-gift-3', 'gift', array[-5002], array['g02'], -5012, 'x12');
  if r ->> 'result' <> 'recorded'
     or (select count(*) from public.sub_events where channel_id = ch and gifter_id = -5012) <> 1
     or (select gifted_at from public.subscriptions where channel_id = ch and kick_user_id = -5012) is null then
    raise exception 'G3: gift with the perk off lost: %', r;
  end if;
  update public.settings set perk_enabled = true where channel_id = ch;

  -- G4. A receiver who is also a VIP (a perk badge) stays protectable: only `subscriber` is stripped.
  perform pg_temp.sub('qa-gift-4', 'gift', array[-5003], array['g03']);
  if not private.perk_eligible(ch, -5003, '{subscriber,vip}') or private.perk_eligible(ch, -5003, '{subscriber}') then
    raise exception 'G4: receiver + VIP';
  end if;

  -- G5. A receiver who then subs themselves: the latest kind wins, and `new` refills.
  perform pg_temp.sub('qa-gift-5', 'gift', array[-5004], array['g04']);
  if private.perk_eligible(ch, -5004, '{subscriber}') then raise exception 'G5: receiver eligible'; end if;
  perform pg_temp.sub('qa-gift-5b', 'new', array[-5004], array['g04']);
  if (select kind from public.subscriptions where channel_id = ch and kick_user_id = -5004) <> 'new'
     or not private.perk_eligible(ch, -5004, '{}') or private.perk_left(ch, -5004) <> 2 then
    raise exception 'G5: own sub after a gift';
  end if;

  -- G6. An anonymous gift: logged with no giver, and no giver row.
  n := (select count(*) from public.subscriptions where channel_id = ch);
  r := pg_temp.sub('qa-gift-6', 'gift', array[-5002], array['g02']);
  if (select count(*) from public.sub_events where channel_id = ch and kind = 'gift' and gifter_id is null and user_ids = '{-5002}') <> 1
     or (select count(*) from public.subscriptions where channel_id = ch) <> n
     or jsonb_array_length(r -> 'refilled') <> 0 then
    raise exception 'G6: anonymous gift: %', r;
  end if;

  -- G7 / B4. Settings: the refill set and a sub_receiver badge save; gift_receiver no longer does.
  perform public.update_settings(ch, '{"perk_refill_on":["gift","new","renewal"]}', gen_random_uuid());
  perform public.update_settings(ch, '{"perk_badges":["subscriber","sub_receiver"]}', gen_random_uuid());
  begin
    perform public.update_settings(ch, '{"perk_refill_on":["gift_receiver"]}', gen_random_uuid());
    raise exception 'G7: accepted gift_receiver';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'G7%' then raise; end if;
  end;

  -- G8 / B2. Sub receiver ticked: a gift refills both, and the receiver is protected.
  update public.settings set perk_badges = '{subscriber,vip,sub_gifter,sub_receiver}' where channel_id = ch;
  insert into public.perk_uses (channel_id, kick_user_id, used_at)
    select ch, -5001, now() - interval '1 day' from generate_series(1, 2);
  r := pg_temp.sub('qa-gift-8', 'gift', array[-5001], array['g01'], -5011, 'w01');
  if private.perk_left(ch, -5001) <> 2 or private.perk_left(ch, -5011) <> 2 or not private.perk_eligible(ch, -5001, '{subscriber}') then
    raise exception 'G8: receiver ticked: %', r;
  end if;
  r := pg_temp.pick(ch, 4, 'teams', true);
  if not exists (select 1 from jsonb_array_elements(r -> 'saved') e
                 join public.players p on p.id = (e ->> 'id')::uuid where p.kick_user_id = -5001) then
    raise exception 'G8: the ticked receiver was not protected: %', r;
  end if;

  -- G9 / B4. The untouched 0049 default was moved to the new one; gift_receiver is gone.
  if exists (select 1 from public.settings where perk_refill_on = '{gift}' or 'gift_receiver' = any(perk_refill_on)) then
    raise exception 'G9: old refill values left';
  end if;

  -- G10. One test: nothing but private.perk_eligible reads perk_badges; server-only.
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname in ('public', 'private') and p.proname <> 'perk_eligible' and p.prosrc ~ '&& s\.perk_badges') then
    raise exception 'G10: a function tests perk badges itself';
  end if;
  if has_table_privilege('anon', 'public.sub_events', 'select') or has_table_privilege('authenticated', 'public.sub_events', 'select')
     or has_function_privilege('anon', 'private.perk_eligible(uuid, bigint, text[])', 'execute')
     or has_function_privilege('authenticated', 'private.perk_eligible(uuid, bigint, text[])', 'execute') then
    raise exception 'G10: grants';
  end if;

  -- G11. Retention: events and giver-only rows go after 90 days.
  delete from public.subscriptions where channel_id = ch;
  delete from public.sub_events where channel_id = ch;
  insert into public.sub_events (channel_id, kind, user_ids, usernames, expires_at, received_at) values
    (ch, 'new', '{-5091}', '{a}', now() - interval '60 days', now() - interval '91 days'),  -- goes
    (ch, 'new', '{-5092}', '{b}', now() + interval '20 days', now() - interval '10 days');  -- stays
  insert into public.subscriptions (channel_id, kick_user_id, gifted_at) values
    (ch, -5093, now() - interval '91 days'),   -- goes
    (ch, -5094, now() - interval '10 days');   -- stays: the gift still counts
  perform private.retention();
  if (select array_agg(user_ids[1]) from public.sub_events where channel_id = ch) is distinct from '{-5092}'::bigint[]
     or (select array_agg(kick_user_id) from public.subscriptions where channel_id = ch) is distinct from '{-5094}'::bigint[] then
    raise exception 'G11: retention';
  end if;
end $$;

select 'gift ok' as result;
