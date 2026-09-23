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

-- One write, one event: the version equals the number of writes.
do $$
begin
  if (select version from public.channels where id = 'c0000000-0000-4000-8000-000000000001')
     <> (select count(*) from public.activity where channel_id = 'c0000000-0000-4000-8000-000000000001') then
    raise exception 'channel version does not match the number of writes';
  end if;
end $$;

select 'rpc ok' as result;
rollback;
