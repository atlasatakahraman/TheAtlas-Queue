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
-- A 10-day-old warning: 100 - 10 × 0.75 = 92.5, which rounds to 93 as Math.round did.
insert into public.moderation (channel_id, kick_username, kind, level, reason, created_at)
  values ('c0000000-0000-4000-8000-000000000001', 'old_timer', 'warn', 1, 'fixture', now() - interval '10 days');

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

  -- D37: p_key places the player in the same write; undo puts the old place back; a key that
  -- is not a finite number refuses.
  perform public.add_player(ch, 'dave', null, gen_random_uuid(), 5::double precision);
  if (select sort_key from public.players where channel_id = ch and kick_username = 'dave') is distinct from 5::double precision then
    raise exception 'add_player: p_key not used';
  end if;
  r := public.move_player(ch, bob, 'away', null, gen_random_uuid(), 4.5::double precision);
  if (select sort_key from public.players where id = bob) is distinct from 4.5::double precision then
    raise exception 'move_player: p_key not used';
  end if;
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform public.undo(ch, act, gen_random_uuid());
  if (select sort_key = 4.5 or status <> 'waiting' from public.players where id = bob) then
    raise exception 'undo: move_player with p_key not restored';
  end if;
  perform pg_temp.expect(format('select public.move_player(%L, %L, %L, null, gen_random_uuid(), %L::double precision)', ch, bob, 'waiting', 'Infinity'), 'request.invalid');
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid(), %L::double precision)', ch, 'erin', 'NaN'), 'request.invalid');

  -- move_players (Pick's All to Team N): one write, one undo; a team without room for all of
  -- them refuses and nobody moves; players already on that team are not a move.
  perform pg_temp.expect(format('select public.move_players(%L, %L::uuid[], 2::smallint, gen_random_uuid())', ch, array[bob, (select id from public.players where channel_id = ch and kick_username = 'dave')]), 'draw.team_full');
  if (select status from public.players where id = bob) <> 'waiting' then raise exception 'move_players: moved on refusal'; end if;
  r := public.move_players(ch, array[bob], 2::smallint, gen_random_uuid());
  if (select status <> 'playing' or team <> 2 from public.players where id = bob) then raise exception 'move_players: bob not on team 2'; end if;
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform public.undo(ch, act, gen_random_uuid());
  if (select status <> 'waiting' or team is not null from public.players where id = bob) then raise exception 'undo: move_players not restored'; end if;
  perform pg_temp.expect(format('select public.move_players(%L, %L::uuid[], 1::smallint, gen_random_uuid())', ch, array[alice]), 'request.invalid');
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
  perform pg_temp.expect(format('select public.pick_players(%L, 0, %L, null, gen_random_uuid())', ch, 'waiting'), 'request.invalid');
  perform pg_temp.expect(format('select public.pick_players(%L, 11, %L, null, gen_random_uuid())', ch, 'waiting'), 'request.invalid');
  r := public.pick_players(ch, 10, 'waiting', null, gen_random_uuid());
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

-- Moderation and respect.
do $$
declare
  ch    constant uuid := 'c0000000-0000-4000-8000-000000000001';
  r     jsonb;
  v_id  uuid;
  act   bigint;
begin
  r := public.warn(ch, 'dan', 'spam', gen_random_uuid());
  if (select (e ->> 'points')::int from pg_temp.rows_of(r, 'respect') e) <> 90 then raise exception 'warn: respect not 90'; end if;
  -- Second warning: level 2, both spent, a 1-game punishment; respect counts the punishment only.
  r := public.warn(ch, 'dan', 'spam again', gen_random_uuid());
  if exists (select 1 from public.moderation where channel_id = ch and kick_username = 'dan' and kind = 'warn' and revoked_at is null)
     or not exists (select 1 from public.moderation where channel_id = ch and kick_username = 'dan' and kind = 'warn' and level = 2)
     or (select games_left from public.moderation where channel_id = ch and kick_username = 'dan' and kind = 'punish') <> 1 then
    raise exception 'warn: second warning did not become a 1-game punishment';
  end if;
  if (select (e ->> 'points')::int from pg_temp.rows_of(r, 'respect') e) <> 80 then raise exception 'warn: respect not 80'; end if;
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid())', ch, 'dan'), 'queue.punished');

  -- Lifting the punishment lets dan join; a lifted punishment still counts against respect.
  select id into v_id from public.moderation where channel_id = ch and kick_username = 'dan' and kind = 'punish';
  r := public.revoke_sanction(ch, v_id, gen_random_uuid());
  if (select (e ->> 'points')::int from pg_temp.rows_of(r, 'respect') e) <> 80 then raise exception 'revoke: respect changed'; end if;
  perform public.add_player(ch, 'dan', null, gen_random_uuid());

  -- Ban: refuses joins, respect 50; deleting it restores respect; undo brings the ban back.
  r := public.ban(ch, 'eve', null, 'toxic', gen_random_uuid());
  if (select (e ->> 'points')::int from pg_temp.rows_of(r, 'respect') e) <> 50 then raise exception 'ban: respect not 50'; end if;
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid())', ch, 'EVE'), 'queue.banned');
  select id into v_id from public.moderation where channel_id = ch and kick_username = 'eve';
  r := public.delete_sanction(ch, v_id, gen_random_uuid());
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  if (select (e ->> 'points')::int from pg_temp.rows_of(r, 'respect') e) <> 100
     or not exists (select 1 from pg_temp.rows_of(r, 'moderation') e where (e ->> '_deleted')::boolean) then
    raise exception 'delete_sanction: respect not restored or no tombstone';
  end if;
  perform public.undo(ch, act, gen_random_uuid());
  if not exists (select 1 from public.moderation where id = v_id and kind = 'ban' and revoked_at is null) then
    raise exception 'undo delete_sanction: ban not back';
  end if;

  -- Punish takes games or minutes, exactly one, in range.
  perform pg_temp.expect(format('select public.punish(%L, %L, 1, 60, null, gen_random_uuid())', ch, 'frank'), 'request.invalid');
  perform pg_temp.expect(format('select public.punish(%L, %L, null, null, null, gen_random_uuid())', ch, 'frank'), 'request.invalid');
  perform pg_temp.expect(format('select public.punish(%L, %L, 11, null, null, gen_random_uuid())', ch, 'frank'), 'request.invalid');
  perform public.punish(ch, 'frank', null, 60, 'afk', gen_random_uuid());
  perform pg_temp.expect(format('select public.add_player(%L, %L, null, gen_random_uuid())', ch, 'frank'), 'queue.punished');

  if (public.get_state(ch) -> 'respect' ->> 'old_timer')::int <> 93 then raise exception 'respect: decay port wrong'; end if;
end $$;

-- Punished players leave the queue (0020): alice leaves team 1 for Punished and nothing but
-- settle or undo moves her; lifting it sends her to the end of waiting; dave, punished from
-- waiting, returns to his place when the time runs out; a ban removes bob and undo brings him back.
do $$
declare
  ch    constant uuid := 'c0000000-0000-4000-8000-000000000001';
  r     jsonb;
  act   bigint;
  v_id  uuid;
  alice uuid;
  bob   uuid;
  dave  uuid;
  k     double precision;
begin
  select id into alice from public.players where channel_id = ch and kick_username = 'alice';
  select id into bob from public.players where channel_id = ch and kick_username = 'bob';
  select id into dave from public.players where channel_id = ch and kick_username = 'dave';

  r := public.punish(ch, 'alice', 2, null, 'fixture', gen_random_uuid());
  if (select status <> 'punished' or team is not null or not punished_from_team from public.players where id = alice) then
    raise exception 'punish: alice not moved from her team to Punished';
  end if;
  perform pg_temp.expect(format('select public.move_player(%L, %L, %L, null, gen_random_uuid())', ch, alice, 'waiting'), 'queue.punished');
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform public.undo(ch, act, gen_random_uuid());
  if (select status <> 'playing' or team <> 1 from public.players where id = alice) then raise exception 'undo punish: alice not back on team 1'; end if;

  perform public.punish(ch, 'alice', 2, null, 'fixture', gen_random_uuid());
  select id into v_id from public.moderation where channel_id = ch and kick_username = 'alice' and kind = 'punish' and revoked_at is null;
  perform public.revoke_sanction(ch, v_id, gen_random_uuid());
  if (select status <> 'waiting' or sort_key < (select max(x.sort_key) from public.players x where x.channel_id = ch and x.deleted_at is null)
      from public.players where id = alice) then
    raise exception 'lift: alice not at the end of waiting';
  end if;

  select sort_key into k from public.players where id = dave;
  perform public.punish(ch, 'dave', null, 5, 'fixture', gen_random_uuid());
  if (select status from public.players where id = dave) <> 'punished' then raise exception 'punish: dave not in Punished'; end if;
  execute 'reset role';
  update public.moderation set expires_at = now() - interval '1 second' where channel_id = ch and kick_username = 'dave';
  perform private.settle_all();
  execute 'set local role authenticated';
  if (select status <> 'waiting' or sort_key <> k from public.players where id = dave) then
    raise exception 'expiry: dave not back at his place';
  end if;

  r := public.ban(ch, 'bob', null, 'fixture', gen_random_uuid());
  if (select deleted_at is null from public.players where id = bob) then raise exception 'ban: bob still queued'; end if;
  select (e ->> 'id')::bigint into act from pg_temp.rows_of(r, 'activity') e;
  perform public.undo(ch, act, gen_random_uuid());
  if (select deleted_at is not null from public.players where id = bob) then raise exception 'undo ban: bob not back'; end if;
end $$;

-- Owner-only settings and membership.
do $$
declare
  ch    constant uuid := 'c0000000-0000-4000-8000-000000000001';
  owner constant text := '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
  modr  constant text := '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
  r     jsonb;
  d     text;
begin
  perform set_config('request.jwt.claims', modr, true);
  perform pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"team_size":3}'), 'auth.role');
  perform pg_temp.expect(format('select public.add_member(%L, -104, %L, gen_random_uuid())', ch, 'new_mod'), 'auth.role');
  perform pg_temp.expect(format('select public.remove_member(%L, -101, gen_random_uuid())', ch), 'auth.role');

  perform set_config('request.jwt.claims', owner, true);
  perform pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"labels":{"en":{"bogus.key":"x"}}}'), 'settings.label_invalid');
  d := pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"join_command":"!a","leave_command":"!a"}'), 'settings.invalid');
  if d::jsonb ->> 'field' <> 'commands' then raise exception 'settings: clash reported as %', d; end if;
  d := pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"team_size":9}'), 'settings.invalid');
  if d::jsonb ->> 'field' <> 'team_size' then raise exception 'settings: team_size reported as %', d; end if;
  perform pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"nope":1}'), 'settings.invalid');
  perform pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"team_size":"abc"}'), 'settings.invalid');
  perform pg_temp.expect(format('select public.update_settings(%L, %L, gen_random_uuid())', ch, '{"team_size":null}'), 'settings.invalid');
  r := public.update_settings(ch, '{"team_size":3,"watch_enabled":true,"watch_sections":["teams"],"labels":{"tr":{"team.1":"Kurtlar"}}}', gen_random_uuid());
  if not exists (select 1 from pg_temp.rows_of(r, 'settings') e
                 where (e ->> 'team_size')::int = 3 and e -> 'labels' -> 'tr' ->> 'team.1' = 'Kurtlar'
                   and e -> 'watch_sections' = '["teams"]'::jsonb and e ->> 'join_command' = '!sıra') then
    raise exception 'update_settings: patch not applied, or it touched other keys: %', r;
  end if;

  perform public.add_member(ch, -104, 'new_mod', gen_random_uuid());
  if not exists (select 1 from public.channel_members where channel_id = ch and kick_user_id = -104 and source = 'manual' and role = 'mod') then
    raise exception 'add_member: row missing';
  end if;
  perform pg_temp.expect(format('select public.set_member_blocked(%L, -101, true, gen_random_uuid())', ch), 'auth.role');
  perform pg_temp.expect(format('select public.remove_member(%L, -101, gen_random_uuid())', ch), 'auth.role');
  perform public.remove_member(ch, -104, gen_random_uuid());

  -- A blocked mod loses access at once.
  perform public.set_member_blocked(ch, -102, true, gen_random_uuid());
  perform set_config('request.jwt.claims', modr, true);
  perform pg_temp.expect(format('select public.get_state(%L)', ch), 'auth.not_member');
  perform set_config('request.jwt.claims', owner, true);
  perform public.set_member_blocked(ch, -102, false, gen_random_uuid());
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
