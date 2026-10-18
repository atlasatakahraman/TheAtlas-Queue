-- 0044 assertions (spec 2026-10-18 § 2 and § 6, X1–X5), plus 0046's removal (case 6). Local stack only:
-- `bun run supabase:check supabase/checks/replace_assert.sql` (wrapped in begin … rollback).
-- Raises on the first failure; the last select returns 'replace ok'.

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from public.players where kick_username = p_name and channel_id in
    ('c0000000-0000-4000-8000-000000000044', 'c0000000-0000-4000-8000-000000000144')
$$;
create function pg_temp.row(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('status', status, 'team', team, 'slot', team_slot, 'key', sort_key)
  from public.players where id = pg_temp.id(p_name)
$$;
create function pg_temp.gone(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('gone', deleted_at is not null) from public.players where id = pg_temp.id(p_name)
$$;
create function pg_temp.act(r jsonb) returns bigint language sql as $$
  select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity' limit 1
$$;
create function pg_temp.version() returns bigint language sql as $$
  select version from public.channels where id = 'c0000000-0000-4000-8000-000000000044'
$$;
create function pg_temp.expect(p_out text, p_in text, p_key text) returns void
language plpgsql as $$
begin
  perform public.replace_player('c0000000-0000-4000-8000-000000000044', pg_temp.id(p_out), pg_temp.id(p_in), gen_random_uuid());
  raise exception 'expected % but % → % succeeded', p_key, p_out, p_in using errcode = 'XX000';
exception when sqlstate 'P0001' then
  if sqlerrm <> p_key then raise exception 'expected %, got % for % → %', p_key, sqlerrm, p_out, p_in using errcode = 'XX000'; end if;
end $$;

insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000044', -144, 'qa_replace_owner');
insert into public.channels (id, kick_channel_id, slug, display_name) values
  ('c0000000-0000-4000-8000-000000000044', -344, 'qa-replace', 'qa replace'),
  ('c0000000-0000-4000-8000-000000000144', -345, 'qa-replace-other', 'qa replace other');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000044', -144, 'owner', 'owner');
insert into public.settings (channel_id, team_size) values ('c0000000-0000-4000-8000-000000000044', 5);
-- t01..t10 playing (odd on team 2, even on team 1, slot = ceil(n / 2)), keys 1..10;
-- w01..w03 waiting, keys 11..13; a01 away; p01 punished; b01 waiting under a ban; d01 waiting but
-- deleted; o01 waiting in another channel.
insert into public.players (channel_id, kick_user_id, kick_username, source, status, team, team_slot, sort_key)
  select 'c0000000-0000-4000-8000-000000000044', -4400 - i, 't' || lpad(i::text, 2, '0'), 'chat', 'playing',
         (1 + i % 2)::smallint, ceil(i / 2.0)::smallint, i
  from generate_series(1, 10) i;
insert into public.players (channel_id, kick_user_id, kick_username, source, status, sort_key)
  select 'c0000000-0000-4000-8000-000000000044', -4410 - i, 'w' || lpad(i::text, 2, '0'), 'chat', 'waiting', 10 + i
  from generate_series(1, 3) i;
insert into public.players (channel_id, kick_user_id, kick_username, source, status, sort_key, deleted_at) values
  ('c0000000-0000-4000-8000-000000000044', -4421, 'a01', 'chat', 'away', 21, null),
  ('c0000000-0000-4000-8000-000000000044', -4422, 'p01', 'chat', 'punished', 22, null),
  ('c0000000-0000-4000-8000-000000000044', -4423, 'b01', 'chat', 'waiting', 23, null),
  ('c0000000-0000-4000-8000-000000000044', -4424, 'd01', 'chat', 'waiting', 24, now()),
  ('c0000000-0000-4000-8000-000000000144', -4425, 'o01', 'chat', 'waiting', 25, null);
insert into public.moderation (channel_id, kick_username, kind, games_left, reason) values
  ('c0000000-0000-4000-8000-000000000044', 'p01', 'punish', 2, 'fixture'),
  ('c0000000-0000-4000-8000-000000000044', 'b01', 'ban', null, 'fixture');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000044","role":"authenticated"}', true);

do $$
declare
  ch     constant uuid := 'c0000000-0000-4000-8000-000000000044';
  rid    constant uuid := gen_random_uuid();
  before jsonb;
  after  jsonb;
  r      jsonb;
  v      bigint;
  a      record;
begin
  -- 1. w02 takes t03's team and slot (team 2, slot 2); t03 is waiting, off the team, and last (X1).
  before := jsonb_build_object('t03', pg_temp.row('t03'), 'w02', pg_temp.row('w02'));
  r := public.replace_player(ch, pg_temp.id('t03'), pg_temp.id('w02'), rid);
  if pg_temp.row('w02') - 'key' <> '{"status":"playing","team":2,"slot":2}'::jsonb then
    raise exception 'case 1: w02 is %', pg_temp.row('w02');
  end if;
  if pg_temp.row('t03') - 'key' <> '{"status":"waiting","team":null,"slot":null}'::jsonb then
    raise exception 'case 1: t03 is %', pg_temp.row('t03');
  end if;
  if (pg_temp.row('t03') ->> 'key')::float8 <= (select max(sort_key) from public.players
      where channel_id = ch and status = 'waiting' and id <> pg_temp.id('t03')) then
    raise exception 'case 1: t03 kept its place (%)', pg_temp.row('t03');
  end if;
  if (select count(*) from public.players where channel_id = ch and status = 'playing' and team = 2) <> 5 then
    raise exception 'case 1: team 2 no longer has five players';
  end if;
  select * into a from public.activity where id = pg_temp.act(r);
  if a.action <> 'replace_player' or a.target <> 't03'
     or a.payload <> '{"out":"t03","in":"w02","team":2}'::jsonb then
    raise exception 'case 1: activity is % % %', a.action, a.target, a.payload;
  end if;

  -- 4. The same request_id again changes nothing.
  after := jsonb_build_object('t03', pg_temp.row('t03'), 'w02', pg_temp.row('w02'));
  v := pg_temp.version();
  if public.replace_player(ch, pg_temp.id('t03'), pg_temp.id('w02'), rid) ->> 'kind' <> 'replay'
     or pg_temp.version() <> v
     or jsonb_build_object('t03', pg_temp.row('t03'), 'w02', pg_temp.row('w02')) <> after then
    raise exception 'case 4: the replay wrote';
  end if;

  -- 3. Undo restores both rows exactly: status, team, slot and sort_key.
  perform public.undo(ch, pg_temp.act(r), gen_random_uuid());
  if jsonb_build_object('t03', pg_temp.row('t03'), 'w02', pg_temp.row('w02')) <> before then
    raise exception 'case 3: undo left % (was %)', jsonb_build_object('t03', pg_temp.row('t03'), 'w02', pg_temp.row('w02')), before;
  end if;

  -- 2. Ineligible incoming or outgoing players are refused, and nothing is written.
  v := pg_temp.version();
  perform pg_temp.expect('t03', 'a01', 'request.invalid');  -- away
  perform pg_temp.expect('t03', 'p01', 'request.invalid');  -- punished
  perform pg_temp.expect('t03', 'b01', 'draw.barred');      -- waiting, under a ban
  perform pg_temp.expect('t03', 'd01', 'request.invalid');  -- deleted
  perform pg_temp.expect('t03', 'o01', 'request.invalid');  -- another channel
  perform pg_temp.expect('t03', 't05', 'request.invalid');  -- already playing
  perform pg_temp.expect('w01', 'w03', 'request.invalid');  -- outgoing not playing
  if pg_temp.version() <> v then raise exception 'case 2: a refused replace wrote'; end if;

  -- 6. With removal (0046, owner 2026-10-18): w03 takes t07's team and slot (team 2, slot 4) and
  --    t07 leaves the queue, keeping its key; one activity with removed: true; undo brings t07 back.
  before := jsonb_build_object('t07', pg_temp.row('t07') || pg_temp.gone('t07'), 'w03', pg_temp.row('w03') || pg_temp.gone('w03'));
  r := public.replace_player(ch, pg_temp.id('t07'), pg_temp.id('w03'), gen_random_uuid(), true);
  if pg_temp.row('w03') - 'key' <> '{"status":"playing","team":2,"slot":4}'::jsonb then
    raise exception 'case 6: w03 is %', pg_temp.row('w03');
  end if;
  if pg_temp.gone('t07') <> '{"gone":true}'::jsonb or pg_temp.row('t07') -> 'key' <> before #> '{t07,key}' then
    raise exception 'case 6: t07 is % %', pg_temp.row('t07'), pg_temp.gone('t07');
  end if;
  select * into a from public.activity where id = pg_temp.act(r);
  if a.action <> 'replace_player' or a.payload <> '{"out":"t07","in":"w03","team":2,"removed":true}'::jsonb then
    raise exception 'case 6: activity is % %', a.action, a.payload;
  end if;
  perform public.undo(ch, pg_temp.act(r), gen_random_uuid());
  if jsonb_build_object('t07', pg_temp.row('t07') || pg_temp.gone('t07'), 'w03', pg_temp.row('w03') || pg_temp.gone('w03')) <> before then
    raise exception 'case 6: undo left t07 % %, w03 %', pg_temp.row('t07'), pg_temp.gone('t07'), pg_temp.row('w03');
  end if;

  -- 5. anon cannot execute it; authenticated can. The four-argument form is gone (0046).
  if has_function_privilege('anon', 'public.replace_player(uuid, uuid, uuid, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.replace_player(uuid, uuid, uuid, uuid, boolean)', 'execute')
     or to_regprocedure('public.replace_player(uuid, uuid, uuid, uuid)') is not null then
    raise exception 'case 5: grants are wrong';
  end if;
end $$;

select 'replace ok';
