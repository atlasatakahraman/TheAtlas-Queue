-- 0042 assertions (protection redesign, spec 2026-10-06 P1–P13). Run with execute_sql as one call:
-- `begin;` + 0042_protection_in_pick.sql + this file + `rollback;` — nothing stays. Raises on the
-- first failure; the last select returns 'protection ok'.

-- Every draw in one transaction shares now(), so latest_draw would tie: each helper call stamps
-- its draw with clock_timestamp() and passes the true latest as the base.
create function pg_temp.pick(p_ch uuid, p_n integer, p_src text, p_again boolean = false, p_rid uuid = gen_random_uuid())
returns jsonb language plpgsql as $$
declare
  r jsonb;
  d uuid;
begin
  r := public.pick_players(p_ch, p_n, p_src,
    (select x.id from public.draws x where x.channel_id = p_ch and x.undone_at is null order by x.created_at desc limit 1),
    p_rid, p_again);
  select (e ->> 'id')::uuid into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  update public.draws x set created_at = clock_timestamp() where x.id = d;
  return (select to_jsonb(x) from public.draws x where x.id = d)
    || jsonb_build_object('activity', (select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity'));
end $$;

create function pg_temp.undo(p_ch uuid, p_draw jsonb) returns void language sql as $$
  select public.undo(p_ch, (p_draw ->> 'activity')::bigint, gen_random_uuid())
$$;

-- Fixture: channel qa-protect, owner qa_owner; perk on, 2 uses per 30 days for subscribers.
-- t01..t10 playing (alternate teams), t01/t02 subscribers; w01..w05 waiting.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000042', -142, 'qa_owner');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000042', -342, 'qa-protect', 'qa protect');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000042', -142, 'owner', 'owner');
insert into public.settings (channel_id, team_size, perk_enabled, perk_uses, perk_window_days, perk_badges)
  values ('c0000000-0000-4000-8000-000000000042', 5, true, 2, 30, '{subscriber}');
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at, status, team, badges)
  select 'c0000000-0000-4000-8000-000000000042', -4000 - i, 't' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 100 - i), 'playing', (1 + i % 2)::smallint,
         case when i <= 2 then '{subscriber}'::text[] else '{}'::text[] end
  from generate_series(1, 10) i;
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at)
  select 'c0000000-0000-4000-8000-000000000042', -4100 - i, 'w' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 50 - i)
  from generate_series(1, 5) i;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000042","role":"authenticated"}', true);

do $$
declare
  ch  constant uuid := 'c0000000-0000-4000-8000-000000000042';
  t1  uuid := (select id from public.players where channel_id = 'c0000000-0000-4000-8000-000000000042' and kick_username = 't01');
  t2  uuid := (select id from public.players where channel_id = 'c0000000-0000-4000-8000-000000000042' and kick_username = 't02');
  t3  uuid := (select id from public.players where channel_id = 'c0000000-0000-4000-8000-000000000042' and kick_username = 't03');
  d   jsonb;
  d2  jsonb;
  s   jsonb;
  ids uuid[];
  rid uuid;
  n   integer;
  hit integer := 0;
begin
  -- 1. Pick 10 from the teams takes everyone: t01/t02 are hit, nobody unprotected is left over,
  --    so protection holds with no stand-in (P6): 8 picked, 2 saved, 2 uses.
  d := pg_temp.pick(ch, 10, 'teams');
  if jsonb_array_length(d #> '{result,picked}') <> 8 then raise exception '1: picked %, expected 8', jsonb_array_length(d #> '{result,picked}'); end if;
  if jsonb_array_length(d #> '{result,saved}') <> 2
     or exists (select 1 from jsonb_array_elements(d #> '{result,saved}') e where e ->> 'standin_id' is not null) then
    raise exception '1: saved %', d #> '{result,saved}';
  end if;
  if (d ->> 'n')::int <> 10 then raise exception '1: draws.n %, expected the requested 10', d ->> 'n'; end if;
  if (select count(*) from public.perk_uses where draw_id = (d ->> 'id')::uuid) <> 2 then raise exception '1: uses not 2'; end if;
  if exists (select 1 from jsonb_array_elements(d #> '{result,saved}') e where (e ->> 'left')::int <> 1) then
    raise exception '1: left %, expected 1', d #> '{result,saved}';
  end if;

  -- 2. Undo gives the uses back.
  perform pg_temp.undo(ch, d);
  if exists (select 1 from public.perk_uses where draw_id = (d ->> 'id')::uuid) then raise exception '2: uses survive undo'; end if;

  -- 3. Pick 1: a save always names a stand-in, an unprotected teammate, who is the one picked.
  for i in 1..30 loop
    d := pg_temp.pick(ch, 1, 'teams');
    for s in select * from jsonb_array_elements(d #> '{result,saved}') loop
      hit := hit + 1;
      if s ->> 'standin_id' is null or (s ->> 'standin_id')::uuid in (t1, t2)
         or (s ->> 'standin_id') <> (d #>> '{result,picked,0,id}') then
        raise exception '3: bad stand-in %', d -> 'result';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(d #> '{result,picked}') e where (e ->> 'id')::uuid in (t1, t2)) then
      raise exception '3: a protected player was picked %', d -> 'result';
    end if;
    perform pg_temp.undo(ch, d);
  end loop;
  if hit = 0 then raise exception '3: 30 picks never hit a protected player'; end if;

  -- 4. Badges are checked at pick time (P8): without the badge t02 is picked like anyone.
  update public.players set badges = '{}' where id = t2;
  d := pg_temp.pick(ch, 10, 'teams');
  if not exists (select 1 from jsonb_array_elements(d #> '{result,picked}') e where (e ->> 'id')::uuid = t2)
     or exists (select 1 from jsonb_array_elements(d #> '{result,saved}') e where (e ->> 'id')::uuid = t2) then
    raise exception '4: t02 without a badge %', d -> 'result';
  end if;
  perform pg_temp.undo(ch, d);

  -- 5. Uses spent to the cap: t01 is picked like anyone.
  insert into public.perk_uses (channel_id, kick_user_id) values (ch, -4001), (ch, -4001);
  d := pg_temp.pick(ch, 10, 'teams');
  if jsonb_array_length(d #> '{result,saved}') <> 0 or jsonb_array_length(d #> '{result,picked}') <> 10 then
    raise exception '5: t01 at the cap %', d -> 'result';
  end if;
  perform pg_temp.undo(ch, d);
  delete from public.perk_uses where channel_id = ch and draw_id is null;
  update public.players set badges = '{subscriber}' where id = t2;

  -- 6. Only t01, t02, t03 playing: Pick 2 hitting both protected has one stand-in (t03) for the
  --    first, none for the second, which comes last.
  update public.players set status = 'waiting', team = null
  where channel_id = ch and status = 'playing' and id not in (t1, t2, t3);
  hit := 0;
  for i in 1..60 loop
    d := pg_temp.pick(ch, 2, 'teams');
    if jsonb_array_length(d #> '{result,saved}') = 2 then
      hit := 1;
      if (d #>> '{result,saved,0,standin_id}')::uuid is distinct from t3 or d #>> '{result,saved,1,standin_id}' is not null
         or jsonb_array_length(d #> '{result,picked}') <> 1 or (d #>> '{result,picked,0,id}')::uuid <> t3 then
        raise exception '6: %', d -> 'result';
      end if;
    end if;
    perform pg_temp.undo(ch, d);
    exit when hit = 1;
  end loop;
  if hit = 0 then raise exception '6: 60 picks never hit both protected'; end if;
  update public.players p set status = 'playing', team = (1 + (substr(p.kick_username, 2)::int) % 2)::smallint
  where p.channel_id = ch and p.kick_username like 't%' and p.status = 'waiting';

  -- 7. Waiting and Whole queue never protect (P1).
  for i in 1..5 loop
    d := pg_temp.pick(ch, 10, 'all');
    d2 := pg_temp.pick(ch, 3, 'waiting');
    if jsonb_array_length(d #> '{result,saved}') + jsonb_array_length(d2 #> '{result,saved}') <> 0 then
      raise exception '7: saved outside teams';
    end if;
    perform pg_temp.undo(ch, d2);
    perform pg_temp.undo(ch, d);
  end loop;

  -- 8. Replay: the same request twice writes one draw and one set of uses.
  rid := gen_random_uuid();
  d := pg_temp.pick(ch, 10, 'teams', false, rid);
  perform public.pick_players(ch, 10, 'teams', null, rid);
  if (select count(*) from public.draws where request_id = rid) <> 1
     or (select count(*) from public.perk_uses where draw_id = (d ->> 'id')::uuid) <> 2 then
    raise exception '8: replay wrote twice';
  end if;
  perform pg_temp.undo(ch, d);

  -- 9. Pick again refunds the pick it replaces; undoing the new pick brings those uses back.
  d := pg_temp.pick(ch, 10, 'teams');
  d2 := pg_temp.pick(ch, 10, 'teams', true);
  if exists (select 1 from public.perk_uses where draw_id = (d ->> 'id')::uuid and refunded_at is null) then
    raise exception '9: Pick again did not refund';
  end if;
  if jsonb_array_length(d2 #> '{result,saved}') <> 2 then raise exception '9: the refund was not usable %', d2 -> 'result'; end if;
  perform pg_temp.undo(ch, d2);
  if (select count(*) from public.perk_uses where draw_id = (d ->> 'id')::uuid and refunded_at is null) <> 2
     or exists (select 1 from public.perk_uses where draw_id = (d2 ->> 'id')::uuid) then
    raise exception '9: undo did not restore the first pick''s uses';
  end if;
  perform pg_temp.undo(ch, d);

  -- 10. Badges follow chat; only the server may write them.
  update public.players set badges = '{}' where id = t2;
  perform public.refresh_badges(-342, -4002, '{subscriber}');
  if (select badges from public.players where id = t2) <> '{subscriber}' then raise exception '10: badges not refreshed'; end if;
  if has_function_privilege('authenticated', 'public.refresh_badges(bigint, bigint, text[])', 'execute')
     or has_function_privilege('anon', 'public.refresh_badges(bigint, bigint, text[])', 'execute') then
    raise exception '10: refresh_badges is callable by clients';
  end if;

  -- 11. The saved line can be relabelled.
  if not private.labels_valid('{"en": {"chat.perk.saved": "x"}}') then raise exception '11: chat.perk.saved rejected'; end if;

  -- The column is gone and the watch payload carries the reveal style (P13).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'locked') then
    raise exception 'players.locked still exists';
  end if;
  if not (private.watch_snapshot_base('qa-protect') ? 'draw_reveal')
     and not coalesce((private.watch_snapshot_base('qa-protect') ->> 'disabled')::boolean, false) then
    raise exception 'watch payload lacks draw_reveal';
  end if;
end $$;

select 'protection ok';
