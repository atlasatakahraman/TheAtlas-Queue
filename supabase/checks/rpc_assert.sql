-- RPC assertions. Run the whole file with execute_sql: it ends in rollback, so the fixture and
-- every realtime message it would send disappear. Raises on the first failure; the last
-- select returns 'rpc ok'. Extend it with every RPC.
begin;

-- Runs p_sql, which must fail with error key p_key; returns the error's detail.
create function pg_temp.expect(p_sql text, p_key text) returns text
language plpgsql as $$
declare
  d text;
begin
  execute p_sql;
  raise exception 'expected % but it succeeded: %', p_key, p_sql using errcode = 'XX000';
exception when sqlstate 'P0001' then
  get stacked diagnostics d = pg_exception_detail;
  if sqlerrm <> p_key then
    raise exception 'expected %, got %: %', p_key, sqlerrm, p_sql using errcode = 'XX000';
  end if;
  return d;
end $$;

-- The event rows of type p_t in an RPC's return value.
create function pg_temp.rows_of(r jsonb, p_t text) returns setof jsonb
language sql as $$ select e from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = p_t $$;

-- Fixture: channel qa-rpc, owner qa_owner, mod qa_mod, outsider qa_out; team size 1.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000001', -101, 'qa_owner'),
  ('a0000000-0000-4000-8000-000000000002', -102, 'qa_mod'),
  ('a0000000-0000-4000-8000-000000000003', -103, 'qa_out');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000001', -101, 'qa-rpc', 'qa');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000001', -101, 'owner', 'owner'),
  ('c0000000-0000-4000-8000-000000000001', -102, 'mod', 'manual');
insert into public.settings (channel_id, team_size) values ('c0000000-0000-4000-8000-000000000001', 1);
insert into public.moderation (channel_id, kick_username, kind, reason)
  values ('c0000000-0000-4000-8000-000000000001', 'banned_guy', 'ban', 'fixture');

-- Draw fixture: channel qa-draw (owner qa_owner), team size 5, fair-play on, one perk use per
-- window; p00..p11 with games_played = i; p00 and p01 are subs and p01 has used its perk
-- already; p11 is punished for 2 games.
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000002', -201, 'qa-draw', 'qa draw');
insert into public.channel_members (channel_id, kick_user_id, role, source)
  values ('c0000000-0000-4000-8000-000000000002', -101, 'owner', 'owner');
insert into public.settings (channel_id, team_size, fair_play, perk_enabled, perk_uses)
  values ('c0000000-0000-4000-8000-000000000002', 5, true, true, 1);
insert into public.players (channel_id, kick_user_id, kick_username, games_played, is_subscriber, badges, source, joined_at)
  select 'c0000000-0000-4000-8000-000000000002', -1000 - i, 'p' || lpad(i::text, 2, '0'), i, i < 2,
         case when i < 2 then array['subscriber'] else '{}'::text[] end, 'chat', now() - make_interval(secs => 100 - i)
  from generate_series(0, 11) i;
insert into public.perk_uses (channel_id, kick_user_id) values ('c0000000-0000-4000-8000-000000000002', -1001);
insert into public.moderation (channel_id, kick_username, kind, games_left, reason)
  values ('c0000000-0000-4000-8000-000000000002', 'p11', 'punish', 2, 'fixture');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Queue RPCs and undo.
do $$
declare
  ch    constant uuid := 'c0000000-0000-4000-8000-000000000001';
  owner constant text := '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
  modr  constant text := '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
  rq    uuid := gen_random_uuid();
  r     jsonb;
  alice uuid;
  bob   uuid;
  act   bigint;
  d     text;
begin
  r := public.add_player(ch, 'alice', null, rq);
  select id into alice from public.players where channel_id = ch and kick_username = 'alice';
  if r ->> 'kind' <> 'add_player' or not exists (select 1 from pg_temp.rows_of(r, 'players') e where (e ->> 'id')::uuid = alice) then
    raise exception 'add_player: event lacks the row: %', r;
  end if;
  r := public.add_player(ch, 'alice', null, rq);
  if r ->> 'kind' <> 'replay' or (select count(*) from public.players where channel_id = ch) <> 1 then
    raise exception 'replayed request_id wrote again';
  end if;
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid())', ch, 'ALICE'), 'queue.duplicate');
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid())', ch, 'Banned_Guy'), 'queue.banned');
  perform pg_temp.expect(format('select public.add_player(%L, %L, %L, gen_random_uuid())', ch, 'carol', 'ab#1'), 'queue.riot_required');

  -- A move into playing counts a game; a full team refuses.
  perform public.move_player(ch, alice, 'playing', 1::smallint, gen_random_uuid());
  if (select games_played from public.players where id = alice) <> 1 then raise exception 'move_player: game not counted'; end if;
  perform public.add_player(ch, 'bob', 'Bob Şampiyon#TR1', gen_random_uuid());
  select id into bob from public.players where channel_id = ch and kick_username = 'bob';
  perform pg_temp.expect(format('select public.move_player(%L, %L, %L, 1::smallint, gen_random_uuid())', ch, bob, 'playing'), 'draw.team_full');

  -- Remove, then undo by another member: back exactly as she was, the restore not counted.
  r := public.remove_players(ch, array[alice], gen_random_uuid());
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform set_config('request.jwt.claims', modr, true);
  perform public.undo(ch, act, gen_random_uuid());
  if (select deleted_at is null and status = 'playing' and team = 1 and games_played = 1 from public.players where id = alice) is not true then
    raise exception 'undo: alice not restored as she was';
  end if;
  perform pg_temp.expect(format('select public.undo(%L, %s, gen_random_uuid())', ch, act), 'undo.changed');

  -- Undo after someone else wrote the row names them.
  r := public.move_player(ch, bob, 'away', null, gen_random_uuid());
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform set_config('request.jwt.claims', owner, true);
  perform public.move_player(ch, bob, 'waiting', null, gen_random_uuid());
  perform set_config('request.jwt.claims', modr, true);
  d := pg_temp.expect(format('select public.undo(%L, %s, gen_random_uuid())', ch, act), 'undo.changed');
  if d::jsonb ->> 'by' is distinct from 'qa_owner' then raise exception 'undo.changed names %', d; end if;

  perform pg_temp.expect(format('select public.remove_protection(%L, %L, gen_random_uuid())', ch, bob), 'request.invalid');
  r := public.set_fair_play(ch, true, gen_random_uuid());
  if not exists (select 1 from pg_temp.rows_of(r, 'settings') e where (e ->> 'fair_play')::boolean) then
    raise exception 'set_fair_play: event lacks settings';
  end if;
  perform set_config('request.jwt.claims', owner, true);
end $$;

-- Draws, reroll, stacked undo, picks, small pools. i(name) = the fixture index of pNN.
do $$
declare
  ch      constant uuid := 'c0000000-0000-4000-8000-000000000002';
  rq      uuid := gen_random_uuid();
  r       jsonb;
  d1      uuid;
  d2      uuid;
  a1      bigint;
  a2      bigint;
  t0      smallint;
  orig    jsonb;
  after1  jsonb;
  picked  uuid[];
begin
  select jsonb_object_agg(kick_username, jsonb_build_array(status, team, games_played, locked)) into orig
  from public.players where channel_id = ch;

  -- Fresh draw, fair-play on: the ten fewest games play (p11 is punished anyway), 5 v 5, each
  -- gains a game; p00 is protected, p01 is out of perk uses; p11 serves one game.
  r := public.draw_teams(ch, null, false, rq);
  select (e ->> 'id')::uuid into d1 from pg_temp.rows_of(r, 'draws') e;
  select (e ->> 'id')::bigint into a1 from pg_temp.rows_of(r, 'activity') e;
  if r ->> 'kind' <> 'draw_teams' then raise exception 'draw: kind %', r ->> 'kind'; end if;
  if exists (select 1 from public.players where channel_id = ch and (status = 'playing') <> (kick_username < 'p10')) then
    raise exception 'draw: fair-play did not pick the ten fewest games';
  end if;
  if exists (select 1 from public.players where channel_id = ch
             and games_played <> substr(kick_username, 2)::int + (kick_username < 'p10')::int) then
    raise exception 'draw: games_played not counted once per drawn player';
  end if;
  if (select count(*) from public.players where channel_id = ch and team = 1) <> 5
     or (select count(*) from public.players where channel_id = ch and team = 2) <> 5 then
    raise exception 'draw: teams are not 5 v 5';
  end if;
  if (select array_agg(kick_username) from public.players where channel_id = ch and locked) is distinct from array['p00'] then
    raise exception 'perk: expected only p00 protected';
  end if;
  if (select count(*) from public.perk_uses where channel_id = ch) <> 2 then raise exception 'perk: use not recorded'; end if;
  if (select games_left from public.moderation where channel_id = ch) <> 1 then raise exception 'punishment: game not served'; end if;

  r := public.draw_teams(ch, null, false, rq);
  if r ->> 'kind' <> 'replay' or (select count(*) from public.draws where channel_id = ch) <> 1 then
    raise exception 'draw: replayed request drew again';
  end if;
  r := public.draw_teams(ch, null, false, gen_random_uuid());
  if r ->> 'kind' <> 'draw_stale' or (select (e ->> 'id')::uuid from pg_temp.rows_of(r, 'draws') e) <> d1
     or (select count(*) from public.draws where channel_id = ch) <> 1 then
    raise exception 'draw: a stale base drew a second time';
  end if;

  select jsonb_object_agg(kick_username, jsonb_build_array(status, team, games_played, locked)) into after1
  from public.players where channel_id = ch;
  select team into t0 from public.players where channel_id = ch and kick_username = 'p00';

  -- Reroll: p00 keeps team and protection; the nine thrown back get their game back, so
  -- fair-play re-picks p01..p09; no perk use, no punishment game.
  r := public.draw_teams(ch, d1, true, gen_random_uuid());
  select (e ->> 'id')::uuid into d2 from pg_temp.rows_of(r, 'draws') e;
  select (e ->> 'id')::bigint into a2 from pg_temp.rows_of(r, 'activity') e;
  if r ->> 'kind' <> 'reroll' or (select rerolled_from from public.draws where id = d2) <> d1 then
    raise exception 'reroll: not recorded as a reroll of the draw';
  end if;
  if (select team = t0 and locked from public.players where channel_id = ch and kick_username = 'p00') is not true then
    raise exception 'reroll: protected p00 lost team or protection';
  end if;
  if exists (select 1 from public.players where channel_id = ch and (status = 'playing') <> (kick_username < 'p10'))
     or exists (select 1 from public.players where channel_id = ch
                and games_played <> substr(kick_username, 2)::int + (kick_username < 'p10')::int) then
    raise exception 'reroll: games_played drifted or fair-play order broke';
  end if;
  if (select count(*) from public.players where channel_id = ch and team = 1) <> 5
     or (select count(*) from public.players where channel_id = ch and team = 2) <> 5 then
    raise exception 'reroll: teams are not 5 v 5';
  end if;
  if (select count(*) from public.perk_uses where channel_id = ch) <> 2 then raise exception 'reroll: consumed a perk use'; end if;
  if (select games_left from public.moderation where channel_id = ch) <> 1 then raise exception 'reroll: served a punishment game'; end if;

  -- Undo the reroll, then the draw: undos stack back to the start.
  perform public.undo(ch, a2, gen_random_uuid());
  if (select jsonb_object_agg(kick_username, jsonb_build_array(status, team, games_played, locked))
      from public.players where channel_id = ch) <> after1
     or (select id from public.draws where channel_id = ch and undone_at is null order by created_at desc limit 1) <> d1 then
    raise exception 'undo reroll: not back to the draw';
  end if;
  perform public.undo(ch, a1, gen_random_uuid());
  if (select jsonb_object_agg(kick_username, jsonb_build_array(status, team, games_played, locked))
      from public.players where channel_id = ch) <> orig
     or exists (select 1 from public.draws where channel_id = ch and undone_at is null)
     or (select count(*) from public.perk_uses where channel_id = ch) <> 1
     or (select games_left from public.moderation where channel_id = ch) <> 2 then
    raise exception 'undo draw: not back to the start';
  end if;

  -- Picks: only from waiting, no duplicates, fewer waiting than N picks them all, nobody moves.
  perform public.move_player(ch, (select id from public.players where channel_id = ch and kick_username = 'p03'), 'away', null, gen_random_uuid());
  perform public.move_player(ch, (select id from public.players where channel_id = ch and kick_username = 'p04'), 'playing', 1::smallint, gen_random_uuid());
  perform pg_temp.expect(format('select public.pick_from_waiting(%L, 0, null, gen_random_uuid())', ch), 'request.invalid');
  perform pg_temp.expect(format('select public.pick_from_waiting(%L, 11, null, gen_random_uuid())', ch), 'request.invalid');
  r := public.pick_from_waiting(ch, 10, null, gen_random_uuid());
  select array_agg((e ->> 'id')::uuid) into picked
  from pg_temp.rows_of(r, 'draws') d, jsonb_array_elements(d -> 'result' -> 'picked') e;
  if cardinality(picked) <> 9 or (select count(distinct x) from unnest(picked) x) <> 9 then
    raise exception 'pick: expected the 9 waiting, distinct, got %', cardinality(picked);
  end if;
  if exists (select 1 from public.players where id = any(picked) and (status <> 'waiting' or kick_username in ('p03', 'p04', 'p11')))
     or (select status from public.players where channel_id = ch and kick_username = 'p04') <> 'playing' then
    raise exception 'pick: picked outside waiting or moved someone';
  end if;

  -- Three players, team size 5: 2 v 1. One player: draw.not_enough.
  perform public.remove_players(ch, (select array_agg(id) from public.players
    where channel_id = ch and deleted_at is null and kick_username not in ('p05', 'p06', 'p07')), gen_random_uuid());
  perform public.draw_teams(ch, (select (e ->> 'id')::uuid from pg_temp.rows_of(r, 'draws') e), false, gen_random_uuid());
  if (select count(*) from public.players where channel_id = ch and deleted_at is null and team = 1) <> 2
     or (select count(*) from public.players where channel_id = ch and deleted_at is null and team = 2) <> 1 then
    raise exception 'draw: 3 players did not split 2 v 1';
  end if;
  perform public.remove_players(ch, (select array_agg(id) from public.players
    where channel_id = ch and deleted_at is null and kick_username <> 'p05'), gen_random_uuid());
  perform pg_temp.expect(format('select public.draw_teams(%L, %L, false, gen_random_uuid())', ch,
    (select id from public.draws where channel_id = ch and undone_at is null order by created_at desc limit 1)), 'draw.not_enough');
end $$;

-- One write, one event: each fixture channel's version equals its number of writes.
do $$
begin
  if exists (select 1 from public.channels c where c.slug in ('qa-rpc', 'qa-draw')
             and c.version <> (select count(*) from public.activity a where a.channel_id = c.id)) then
    raise exception 'channel version does not match the number of writes';
  end if;
end $$;

select 'rpc ok' as result;
rollback;
