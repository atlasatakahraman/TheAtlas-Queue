-- 0016 assertions (August parity). Run the whole file with execute_sql: it ends in rollback.
-- Raises on the first failure; the last select returns 'parity ok'.
begin;

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

-- Fixture: channel qa-parity, owner qa_owner, mod qa_mod; team size 5; p00..p11 waiting, p00
-- protected (locked); two sanctions.
insert into public.profiles (id, kick_user_id, username) values
  ('a0000000-0000-4000-8000-000000000001', -101, 'qa_owner'),
  ('a0000000-0000-4000-8000-000000000002', -102, 'qa_mod');
insert into public.channels (id, kick_channel_id, slug, display_name)
  values ('c0000000-0000-4000-8000-000000000003', -301, 'qa-parity', 'qa parity');
insert into public.channel_members (channel_id, kick_user_id, role, source) values
  ('c0000000-0000-4000-8000-000000000003', -101, 'owner', 'owner'),
  ('c0000000-0000-4000-8000-000000000003', -102, 'mod', 'manual');
insert into public.settings (channel_id, team_size) values ('c0000000-0000-4000-8000-000000000003', 5);
insert into public.players (channel_id, kick_user_id, kick_username, source, joined_at)
  select 'c0000000-0000-4000-8000-000000000003', -3000 - i, 'p' || lpad(i::text, 2, '0'), 'chat',
         now() - make_interval(secs => 100 - i)
  from generate_series(0, 11) i;
insert into public.moderation (channel_id, kick_username, kind, level, reason) values
  ('c0000000-0000-4000-8000-000000000003', 'someone', 'warn', 1, 'fixture'),
  ('c0000000-0000-4000-8000-000000000003', 'other', 'ban', null, 'fixture');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  ch    constant uuid := 'c0000000-0000-4000-8000-000000000003';
  owner constant text := '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
  modr  constant text := '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
  r      jsonb;
  d      jsonb;
  base   uuid;
  before jsonb;
  games  jsonb;
  v_lock uuid;
  n      integer;
begin
  -- Nothing to shuffle, clear or pick from the teams before a draw.
  perform pg_temp.expect(format('select public.shuffle_teams(%L, null, gen_random_uuid())', ch), 'draw.not_enough');
  perform pg_temp.expect(format('select public.clear_teams(%L, gen_random_uuid())', ch), 'teams.empty');
  perform pg_temp.expect(format('select public.pick_players(%L, 1, %L, null, gen_random_uuid())', ch, 'teams'), 'draw.not_enough');
  perform pg_temp.expect(format('select public.pick_players(%L, 1, %L, null, gen_random_uuid())', ch, 'nobody'), 'request.invalid');

  r := public.draw_teams(ch, null, false, gen_random_uuid());
  base := (select (e ->> 'id')::uuid from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws');
  -- Protect one player of team 1 by hand, as the perk would.
  select id into v_lock from public.players where channel_id = ch and team = 1 limit 1;
  reset role;
  update public.players set locked = true where id = v_lock;
  update public.draws set created_at = created_at - interval '1 minute' where channel_id = ch;
  set local role authenticated;

  -- Shuffle: same ten players, 5 v 5, the protected one stays, no game counted, a new teams
  -- draw that rerolls the standing one; stale base refused.
  select jsonb_object_agg(id, games_played), jsonb_agg(id order by id) into games, before
  from public.players where channel_id = ch and status = 'playing';
  perform set_config('request.jwt.claims', modr, true);
  r := public.shuffle_teams(ch, gen_random_uuid(), gen_random_uuid());
  if r ->> 'kind' <> 'draw_stale' then raise exception 'shuffle: stale base not refused: %', r; end if;
  r := public.shuffle_teams(ch, base, gen_random_uuid());
  select e into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  if (d ->> 'rerolled_from')::uuid <> base or d ->> 'kind' <> 'teams'
     or jsonb_array_length(d #> '{result,teams,0}') <> 5 or jsonb_array_length(d #> '{result,teams,1}') <> 5 then
    raise exception 'shuffle: draw row wrong: %', d;
  end if;
  if (select jsonb_agg(id order by id) from public.players where channel_id = ch and status = 'playing') <> before
     or (select jsonb_object_agg(id, games_played) from public.players where channel_id = ch and status = 'playing') <> games
     or (select team from public.players where id = v_lock) <> 1 then
    raise exception 'shuffle: players, games or the protected team changed';
  end if;
  base := (d ->> 'id')::uuid;
  -- One transaction means one now(): age the earlier draws so the latest is unambiguous.
  reset role;
  update public.draws set created_at = created_at - interval '1 minute' where channel_id = ch;
  set local role authenticated;

  -- Picks by source.
  r := public.pick_players(ch, 10, 'teams', base, gen_random_uuid());
  select e into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  if r ->> 'kind' <> 'pick_from_teams' or exists (
       select 1 from jsonb_array_elements(d #> '{result,picked}') x
       join public.players p on p.id = (x ->> 'id')::uuid where p.status <> 'playing') then
    raise exception 'pick teams: picked outside the teams: %', r;
  end if;
  base := (d ->> 'id')::uuid;
  -- One transaction means one now(): age the earlier draws so the latest is unambiguous.
  reset role;
  update public.draws set created_at = created_at - interval '1 minute' where channel_id = ch;
  set local role authenticated;
  r := public.pick_players(ch, 10, 'all', base, gen_random_uuid());
  select e into d from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'draws';
  if r ->> 'kind' <> 'pick_from_all' or jsonb_array_length(d #> '{result,picked}') <> 10 then
    raise exception 'pick all: %', r;
  end if;

  -- Clear teams: everyone back to waiting, protection ends; undo puts them back.
  r := public.clear_teams(ch, gen_random_uuid());
  if exists (select 1 from public.players where channel_id = ch and (status = 'playing' or locked or team is not null)) then
    raise exception 'clear_teams: someone is still on a team';
  end if;
  perform public.undo(ch, (select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity'), gen_random_uuid());
  if (select jsonb_agg(id order by id) from public.players where channel_id = ch and status = 'playing') <> before
     or not (select p.locked from public.players p where p.id = v_lock) then
    raise exception 'clear_teams undo: teams not restored';
  end if;

  -- Clear moderation: owner only; undo brings both rows back.
  perform pg_temp.expect(format('select public.clear_moderation(%L, gen_random_uuid())', ch), 'auth.role');
  perform set_config('request.jwt.claims', owner, true);
  r := public.clear_moderation(ch, gen_random_uuid());
  if exists (select 1 from public.moderation where channel_id = ch)
     or (select count(*) from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'moderation' and e ? '_deleted') <> 2 then
    raise exception 'clear_moderation: rows left or events missing: %', r;
  end if;
  perform pg_temp.expect(format('select public.clear_moderation(%L, gen_random_uuid())', ch), 'moderation.empty');
  perform public.undo(ch, (select (e ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') e where e ->> '_t' = 'activity'), gen_random_uuid());
  select count(*) into n from public.moderation where channel_id = ch;
  if n <> 2 then raise exception 'clear_moderation undo: % rows back, expected 2', n; end if;
end $$;

-- Riot win rate and level: service role only, carried in the player's rank.
reset role;
update public.players set riot_id = 'Parity#TR1' where channel_id = 'c0000000-0000-4000-8000-000000000003' and kick_username = 'p05';
set local role service_role;
do $$
declare
  r jsonb;
begin
  r := public.set_riot_rank('c0000000-0000-4000-8000-000000000003', 'parity#tr1', 'qa-parity-puuid', 'Parity', 'TR1',
    'GOLD', 'II', 40, 7, 30, 10, 250);
  if (r ->> 'players')::integer <> 1 then raise exception 'set_riot_rank: %', r; end if;
end $$;
reset role;
do $$
begin
  if (select private.player_json(p) -> 'rank' from public.players p
      where p.channel_id = 'c0000000-0000-4000-8000-000000000003' and p.kick_username = 'p05')
     @> '{"wins":30,"losses":10,"level":250}' is not true then
    raise exception 'player_json: rank lacks wins/losses/level';
  end if;
  if has_function_privilege('authenticated', 'public.set_riot_rank(uuid, text, text, text, text, text, text, integer, integer, integer, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.clear_teams(uuid, uuid)', 'execute')
     or exists (select 1 from pg_proc where proname = 'pick_from_waiting') then
    raise exception 'grants: set_riot_rank open to members, clear_teams to anon, or pick_from_waiting still there';
  end if;
end $$;

select 'parity ok' as result;
rollback;
