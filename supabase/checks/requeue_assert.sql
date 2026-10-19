-- 0043 assertions (spec 2026-10-18 § 1, R1–R5), and 0048's one end (case 10). Local stack only:
-- `bun run supabase:check supabase/checks/requeue_assert.sql` (wrapped in begin … rollback).
-- Raises on the first failure; the last select returns 'requeue ok'.
-- Undo refuses once a later write touched the same rows (undo.changed), so each undo runs right
-- after the action it reverts.

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from public.players where channel_id = 'c0000000-0000-4000-8000-000000000043' and kick_username = p_name
$$;
create function pg_temp.key(p_name text) returns double precision language sql as $$
  select sort_key from public.players where id = pg_temp.id(p_name)
$$;
create function pg_temp.act(r jsonb) returns bigint language sql as $$
  select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity' limit 1
$$;
create function pg_temp.undo(r jsonb) returns jsonb language sql as $$
  select public.undo('c0000000-0000-4000-8000-000000000043', pg_temp.act(r), gen_random_uuid())
$$;
-- Highest key among players waiting now that are not in p_ids.
create function pg_temp.max_other(p_ids uuid[]) returns double precision language sql as $$
  select max(sort_key) from public.players
  where channel_id = 'c0000000-0000-4000-8000-000000000043' and status = 'waiting' and id <> all (p_ids)
$$;
-- t01..t10 playing, odd on team 2 and even on team 1, keys 1..10 (they joined first, as live);
-- w01..w05 waiting, keys 11..15. A player off a team who kept their key would jump the queue.
create function pg_temp.seed() returns void language sql as $$
  update public.players p set
    status = case when p.kick_username like 't%' then 'playing' else 'waiting' end,
    team = case when p.kick_username like 't%' then (1 + right(p.kick_username, 2)::int % 2)::smallint end,
    team_slot = case when p.kick_username like 't%' then ceil(right(p.kick_username, 2)::int / 2.0)::smallint end,
    sort_key = right(p.kick_username, 2)::int + case when p.kick_username like 'w%' then 10 else 0 end,
    punished_from_team = false, deleted_at = null
  where p.channel_id = 'c0000000-0000-4000-8000-000000000043'
$$;

insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000043', -143, 'qa_requeue_owner');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000043', -343, 'qa-requeue', 'qa requeue');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000043', -143, 'owner', 'owner');
insert into public.settings (channel_id, team_size) values ('c0000000-0000-4000-8000-000000000043', 5);
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at)
  select 'c0000000-0000-4000-8000-000000000043', -4300 - i, 't' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 100 - i)
  from generate_series(1, 10) i;
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at)
  select 'c0000000-0000-4000-8000-000000000043', -4400 - i, 'w' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 50 - i)
  from generate_series(1, 5) i;
select pg_temp.seed();

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000043","role":"authenticated"}', true);

do $$
declare
  ch  constant uuid := 'c0000000-0000-4000-8000-000000000043';
  r   jsonb;
  ids uuid[];
  n   integer;
  m   integer;
  k1  double precision;
  k2  double precision;
  g   uuid;
begin
  -- 1. A single move off a team lands past every waiting player (R1).
  r := public.move_player(ch, pg_temp.id('t01'), 'waiting', null, gen_random_uuid(), null);
  if pg_temp.key('t01') <= pg_temp.max_other(array[pg_temp.id('t01')]) then
    raise exception 'case 1: t01 kept its place (key %)', pg_temp.key('t01');
  end if;

  -- 8. !position counts in the visible order (R5): t01 is last of six waiting.
  select x.n into m from (select id, row_number() over (order by sort_key, joined_at) n from public.players
                          where channel_id = ch and status = 'waiting' and deleted_at is null) x
  where x.id = pg_temp.id('t01');
  n := (public.ingest_chat(-343, 'qa-requeue-pos-1', 'position', null, -4301, 't01', '{}', null) ->> 'position')::int;
  if n is distinct from m then raise exception 'case 8: !position % <> visible index %', n, m; end if;

  -- 7a. Undo puts the key back.
  perform pg_temp.undo(r);
  if pg_temp.key('t01') <> 1 then raise exception 'case 7: undo of the move left key %', pg_temp.key('t01'); end if;

  -- 2. An explicit key (a drag onto a place) still wins (R4).
  r := public.move_player(ch, pg_temp.id('t02'), 'waiting', null, gen_random_uuid(), 2.5);
  if pg_temp.key('t02') <> 2.5 then raise exception 'case 2: t02 key % <> 2.5', pg_temp.key('t02'); end if;

  -- 3. team → away gets the end key; waiting → away → waiting keeps it (R3).
  perform pg_temp.seed();
  r := public.move_player(ch, pg_temp.id('t03'), 'away', null, gen_random_uuid(), null);
  if pg_temp.key('t03') <= pg_temp.max_other('{}') then raise exception 'case 3: t03 → away kept key %', pg_temp.key('t03'); end if;
  r := public.move_player(ch, pg_temp.id('w01'), 'away', null, gen_random_uuid(), null);
  r := public.move_player(ch, pg_temp.id('w01'), 'waiting', null, gen_random_uuid(), null);
  if pg_temp.key('w01') <> 11 then raise exception 'case 3: w01 away → waiting moved to %', pg_temp.key('w01'); end if;

  -- 4. Clear teams: everyone returned is past the waiting, in their old order (R1, R2).
  perform pg_temp.seed();
  select array_agg(id) into ids from public.players where channel_id = ch and status = 'playing';
  r := public.clear_teams(ch, gen_random_uuid());
  if (select min(sort_key) from public.players where id = any(ids)) <= pg_temp.max_other(ids) then
    raise exception 'case 4: a cleared player is not past the waiting';
  end if;
  if (select array_agg(kick_username order by sort_key) from public.players where id = any(ids))
     <> (select array_agg('t' || lpad(i::text, 2, '0') order by i) from generate_series(1, 10) i) then
    raise exception 'case 4: cleared players lost their relative order';
  end if;
  -- A midpoint between two requeued neighbours sorts between them (the reorder drag).
  k1 := pg_temp.key('t03'); k2 := pg_temp.key('t04');
  perform public.move_player(ch, pg_temp.id('w01'), 'waiting', null, gen_random_uuid(), (k1 + k2) / 2);
  if not (pg_temp.key('w01') > k1 and pg_temp.key('w01') < k2) then
    raise exception 'case 4: midpoint % not between % and %', pg_temp.key('w01'), k1, k2;
  end if;
  -- 7b.
  perform pg_temp.undo(r);
  if exists (select 1 from public.players where id = any(ids) and sort_key <> right(kick_username, 2)::int) then
    raise exception 'case 7: undo of clear_teams did not restore the keys';
  end if;

  -- 5. A fresh draw: whoever was playing and now waits is past whoever waited before.
  perform pg_temp.seed();
  select array_agg(id) into ids from public.players where channel_id = ch and status = 'playing';
  r := public.draw_teams(ch, (private.latest_draw(ch)).id, false, gen_random_uuid());
  if exists (select 1 from public.players a, public.players w
             where a.id = any(ids) and a.status = 'waiting' and w.channel_id = ch
               and w.kick_username like 'w%' and a.sort_key <= w.sort_key) then
    raise exception 'case 5: a player sent back by the draw is not past the earlier waiting';
  end if;

  -- 6. Record a game, after_game = queue: every player returns to the end.
  perform pg_temp.seed();
  update public.settings set after_game = 'queue' where channel_id = ch;
  select array_agg(id) into ids from public.players where channel_id = ch and status = 'playing';
  g := (select x.id from public.games x where x.channel_id = ch and x.removed_at is null order by x.n desc limit 1);
  r := public.record_game(ch, 1::smallint, g, gen_random_uuid());
  if (select min(sort_key) from public.players where id = any(ids)) <= pg_temp.max_other(ids) then
    raise exception 'case 6: after_game queue left a player in place';
  end if;
  -- 7c.
  perform pg_temp.undo(r);
  if exists (select 1 from public.players where id = any(ids) and sort_key <> right(kick_username, 2)::int) then
    raise exception 'case 7: undo of record_game did not restore the keys';
  end if;

  -- 6b. after_game = losers: losers return to the end, winners keep their key.
  perform pg_temp.seed();
  update public.settings set after_game = 'losers' where channel_id = ch;
  g := (select x.id from public.games x where x.channel_id = ch and x.removed_at is null order by x.n desc limit 1);
  r := public.record_game(ch, 1::smallint, g, gen_random_uuid());
  select array_agg(id) into ids from public.players where channel_id = ch and kick_username like 't%' and status = 'waiting';
  if cardinality(ids) <> 5 or (select min(sort_key) from public.players where id = any(ids)) <= pg_temp.max_other(ids) then
    raise exception 'case 6: after_game losers did not send the losers to the end';
  end if;
  if exists (select 1 from public.players where channel_id = ch and status = 'playing'
             and sort_key <> right(kick_username, 2)::int) then
    raise exception 'case 6: a winner lost their key';
  end if;

  -- 10. The end is past every key, not just the clock (0048): a drag to the bottom keys the last
  -- player + 1 s, and a player sent off a team (move, clear, settle) still lands after them.
  perform pg_temp.seed();
  update public.players set sort_key = extract(epoch from clock_timestamp()) + 100 where id = pg_temp.id('w05');
  r := public.move_player(ch, pg_temp.id('t01'), 'waiting', null, gen_random_uuid(), null);
  if pg_temp.key('t01') <= pg_temp.key('w05') then
    raise exception 'case 10: move landed at % above the dragged w05 at %', pg_temp.key('t01'), pg_temp.key('w05');
  end if;
  r := public.clear_teams(ch, gen_random_uuid());
  if (select min(sort_key) from public.players where channel_id = ch and kick_username like 't%' and kick_username <> 't01')
     <= pg_temp.key('t01') then
    raise exception 'case 10: clear_teams landed above the previous end';
  end if;
  perform pg_temp.seed();
  update public.players set sort_key = extract(epoch from clock_timestamp()) + 100 where id = pg_temp.id('w05');
  update public.players set status = 'punished', team = null, team_slot = null, punished_from_team = true
  where id = pg_temp.id('t02');
  perform private.settle(ch, 0, 'qa');
  if (select status from public.players where id = pg_temp.id('t02')) <> 'waiting'
     or pg_temp.key('t02') <= pg_temp.key('w05') then
    raise exception 'case 10: settle left t02 % at key %', (select status from public.players where id = pg_temp.id('t02')), pg_temp.key('t02');
  end if;
end $$;

-- 9. The !position line is the only change to ingest_chat (hash of the body without it, pre-0043).
do $$
begin
  if md5(regexp_replace(pg_get_functiondef('public.ingest_chat'::regproc),
       E'\n *where x\\.channel_id = l\\.channel_id and x\\.deleted_at is null and x\\.status = ''waiting'' and [^\n]*', '', 'g'))
     <> '42b414eaf654d6000b6696975d994ca1' then
    raise exception 'case 9: ingest_chat changed beyond the !position line';
  end if;
end $$;

select 'requeue ok';
