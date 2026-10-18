-- 0045 assertions (spec 2026-10-18 § 3 and § 6, C1–C4). Local stack only:
-- `bun run supabase:check supabase/checks/custom_pick_assert.sql` (wrapped in begin … rollback).
-- Raises on the first failure; the last select returns 'custom pick ok'.

-- As protection_assert: each draw is stamped with clock_timestamp() so the next call's base is the
-- true latest, plus the hand-ticked pool.
create function pg_temp.pick(p_ch uuid, p_n integer, p_src text, p_ids uuid[] = null, p_again boolean = false)
returns jsonb language plpgsql as $$
declare
  r jsonb;
  d uuid;
begin
  r := public.pick_players(p_ch, p_n, p_src,
    (select x.id from public.draws x where x.channel_id = p_ch and x.undone_at is null order by x.created_at desc limit 1),
    gen_random_uuid(), p_again, p_ids);
  select (e ->> 'id')::uuid into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  update public.draws x set created_at = clock_timestamp() where x.id = d;
  return (select to_jsonb(x) from public.draws x where x.id = d)
    || jsonb_build_object('activity', (select to_jsonb(a) from public.activity a
         where a.id = (select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity')));
end $$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from public.players where kick_username = p_name and channel_id in
    ('c0000000-0000-4000-8000-000000000046', 'c0000000-0000-4000-8000-000000000146')
$$;
create function pg_temp.ids(p_names text[]) returns uuid[] language sql as $$
  select array_agg(pg_temp.id(n)) from unnest(p_names) n
$$;
create function pg_temp.picked(d jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e ->> 'id')::uuid), '{}') from jsonb_array_elements(d #> '{result,picked}') e
$$;
create function pg_temp.expect(p_src text, p_ids uuid[], p_key text) returns void
language plpgsql as $$
begin
  perform pg_temp.pick('c0000000-0000-4000-8000-000000000046', 1, p_src, p_ids);
  raise exception 'expected % but % with % ids succeeded', p_key, p_src, cardinality(p_ids) using errcode = 'XX000';
exception when sqlstate 'P0001' then
  if sqlerrm <> p_key then raise exception 'expected %, got % for % with % ids', p_key, sqlerrm, p_src, cardinality(p_ids) using errcode = 'XX000'; end if;
end $$;

-- Fixture: channel qa-custom, perk on (2 uses / 30 days, subscribers); t01..t10 playing (t01 a
-- subscriber with uses left), w01..w05 waiting, a01 away, p01 punished, b01 waiting under a ban,
-- d01 waiting but deleted, o01 waiting in another channel.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000046', -146, 'qa_custom_owner');
insert into public.channels (id, kick_channel_id, slug, display_name) values
  ('c0000000-0000-4000-8000-000000000046', -346, 'qa-custom', 'qa custom'),
  ('c0000000-0000-4000-8000-000000000146', -347, 'qa-custom-other', 'qa custom other');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000046', -146, 'owner', 'owner');
insert into public.settings (channel_id, team_size, perk_enabled, perk_uses, perk_window_days, perk_badges)
  values ('c0000000-0000-4000-8000-000000000046', 5, true, 2, 30, '{subscriber}');
insert into public.players (channel_id, kick_user_id, kick_username, source, status, team, badges)
  select 'c0000000-0000-4000-8000-000000000046', -4600 - i, 't' || lpad(i::text, 2, '0'), 'chat', 'playing',
         (1 + i % 2)::smallint, case when i = 1 then '{subscriber}'::text[] else '{}'::text[] end
  from generate_series(1, 10) i;
insert into public.players (channel_id, kick_user_id, kick_username, source)
  select 'c0000000-0000-4000-8000-000000000046', -4610 - i, 'w' || lpad(i::text, 2, '0'), 'chat'
  from generate_series(1, 5) i;
insert into public.players (channel_id, kick_user_id, kick_username, source, status, deleted_at) values
  ('c0000000-0000-4000-8000-000000000046', -4621, 'a01', 'chat', 'away', null),
  ('c0000000-0000-4000-8000-000000000046', -4622, 'p01', 'chat', 'punished', null),
  ('c0000000-0000-4000-8000-000000000046', -4623, 'b01', 'chat', 'waiting', null),
  ('c0000000-0000-4000-8000-000000000046', -4624, 'd01', 'chat', 'waiting', now()),
  ('c0000000-0000-4000-8000-000000000146', -4625, 'o01', 'chat', 'waiting', null);
insert into public.moderation (channel_id, kick_username, kind, games_left, reason) values
  ('c0000000-0000-4000-8000-000000000046', 'p01', 'punish', 2, 'fixture'),
  ('c0000000-0000-4000-8000-000000000046', 'b01', 'ban', null, 'fixture');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000046","role":"authenticated"}', true);

do $$
declare
  ch   constant uuid := 'c0000000-0000-4000-8000-000000000046';
  pool uuid[];
  d    jsonb;
  src  text;
begin
  -- 1. Picks only from the given ids, waiting and team players alike.
  pool := pg_temp.ids('{w01,t02,t05}');
  for i in 1..50 loop
    d := pg_temp.pick(ch, 3, 'custom', pool);
    if cardinality(pg_temp.picked(d)) <> 3 or not pg_temp.picked(d) <@ pool then
      raise exception '1: picked % from %', pg_temp.picked(d), pool;
    end if;
  end loop;

  -- 2. Another channel's, a deleted, away, punished or banned player's id is dropped silently.
  pool := pg_temp.ids('{a01,p01,b01,d01,o01,w02}');
  for i in 1..30 loop
    d := pg_temp.pick(ch, 1, 'custom', pool);
    if pg_temp.picked(d) <> array[pg_temp.id('w02')] then raise exception '2: picked %', pg_temp.picked(d); end if;
  end loop;

  -- 3. The pool is bounded and belongs to custom alone.
  perform pg_temp.expect('custom', null, 'request.invalid');
  perform pg_temp.expect('custom', '{}', 'request.invalid');
  perform pg_temp.expect('custom', array(select gen_random_uuid() from generate_series(1, 513)), 'request.invalid');
  perform pg_temp.expect('waiting', pg_temp.ids('{w01}'), 'request.invalid');

  -- 4. Nobody eligible left in the pool.
  perform pg_temp.expect('custom', pg_temp.ids('{a01,p01}'), 'draw.not_enough');

  -- 5. No protection (C4): a protected team player is picked like anyone and spends no use.
  d := pg_temp.pick(ch, 1, 'custom', pg_temp.ids('{t01}'));
  if pg_temp.picked(d) <> array[pg_temp.id('t01')] or jsonb_array_length(d #> '{result,saved}') <> 0 then
    raise exception '5: %', d -> 'result';
  end if;
  if exists (select 1 from public.perk_uses u where u.draw_id = (d ->> 'id')::uuid) then raise exception '5: a use was spent'; end if;

  -- 6. Every pick records its source; the custom one logs pick_from_custom {draw, n, saved: 0}.
  foreach src in array array['waiting', 'teams', 'all', 'custom'] loop
    d := pg_temp.pick(ch, 2, src, case when src = 'custom' then pg_temp.ids('{w01,w03}') end);
    if d #>> '{result,source}' is distinct from src then raise exception '6: source % for %', d #>> '{result,source}', src; end if;
    if d #>> '{activity,action}' <> 'pick_from_' || src then raise exception '6: action %', d #>> '{activity,action}'; end if;
  end loop;
  if d #> '{activity,payload}' <> jsonb_build_object('draw', d -> 'id', 'n', 2, 'saved', 0) then
    raise exception '6: payload %', d #> '{activity,payload}';
  end if;
end $$;

-- 7. anon cannot execute it.
set local role anon;
do $$
begin
  perform public.pick_players('c0000000-0000-4000-8000-000000000046', 1, 'custom', null, gen_random_uuid(), false,
    array['c0000000-0000-4000-8000-000000000046'::uuid]);
  raise exception '7: anon executed pick_players' using errcode = 'XX000';
exception when insufficient_privilege then null;
end $$;
reset role;

select 'custom pick ok';
