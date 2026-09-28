-- A team's rows have fixed slots (owner, 2026-09-28): a player added on the empty slot 4 lands in
-- slot 4 with slot 3 left empty, and a player who leaves leaves their slot empty. A drop on a
-- taken slot inserts there and pushes the others toward the nearest empty slot. Draws and
-- Shuffle fill from the top; Pick and a move without a slot take the first empty one.

alter table public.players add column team_slot smallint;

update public.players p set team_slot = x.n
from (select id, row_number() over (partition by channel_id, team order by sort_key, joined_at) n
      from public.players where status = 'playing' and deleted_at is null) x
where p.id = x.id;

-- Keeps team_slot true to status and team on every write: off a team it is null; a team change
-- that names no slot of its own, or a join without one, takes the team's first empty slot. An
-- Undo restores the captured slot as it was (queue.restoring).
create function private.team_slot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'playing' or new.team is null or new.deleted_at is not null then
    new.team_slot := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team is distinct from old.team and new.team_slot is not distinct from old.team_slot
     and coalesce(current_setting('queue.restoring', true), 'off') <> 'on' then
    new.team_slot := null;
  end if;
  if new.team_slot is null then
    select min(g) into new.team_slot from generate_series(1, 50) g
    where not exists (select 1 from public.players x
                      where x.channel_id = new.channel_id and x.deleted_at is null and x.status = 'playing'
                        and x.team = new.team and x.team_slot = g and x.id <> new.id);
  end if;
  return new;
end $$;
revoke execute on function private.team_slot() from public, anon, authenticated;

create trigger players_team_slot before insert or update of status, team, team_slot, deleted_at on public.players
for each row execute function private.team_slot();

-- Into a team at p_slot when given: a taken slot is inserted into, its player and those after it
-- moving down to the nearest empty slot (up, when none is empty below). One write, one Undo,
-- which puts every moved player back.
drop function public.move_player(uuid, uuid, text, smallint, uuid, double precision);
create function public.move_player(p_channel uuid, p_player uuid, p_status text, p_team smallint, p_request_id uuid,
  p_key double precision default null, p_slot smallint default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  p      public.players;
  v_size smallint;
  v_free smallint;
  v_push uuid[] := '{}';
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_status not in ('waiting', 'playing', 'away')
     or (p_status = 'playing') <> (p_team is not null)
     or (p_team is not null and p_team not in (1, 2))
     or (p_slot is not null and p_status <> 'playing') then
    perform private.fail('request.invalid');
  end if;
  perform private.check_key(p_key);
  select * into p from public.players x where x.id = p_player and x.channel_id = p_channel and x.deleted_at is null;
  if not found then perform private.fail('request.invalid'); end if;
  select s.team_size into v_size from public.settings s where s.channel_id = p_channel;
  if p_slot is not null and p_slot not between 1 and v_size then perform private.fail('request.invalid'); end if;

  if p_status = 'playing' and p.team is distinct from p_team
     and (select count(*) from public.players x
          where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
         >= v_size then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  -- The slot is taken by someone else: the nearest empty slot below it, else above it, and the
  -- players between that and the slot, who each move one toward it.
  if p_slot is not null and exists (select 1 from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.team_slot = p_slot and x.id <> p_player) then
    select min(g) into v_free from generate_series(p_slot + 1, v_size) g
    where not exists (select 1 from public.players x
                      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing'
                        and x.team = p_team and x.team_slot = g and x.id <> p_player);
    if v_free is not null then
      select coalesce(array_agg(x.id), '{}') into v_push from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.id <> p_player and x.team_slot >= p_slot and x.team_slot < v_free;
    else
      select max(g) into v_free from generate_series(1, p_slot - 1) g
      where not exists (select 1 from public.players x
                        where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing'
                          and x.team = p_team and x.team_slot = g and x.id <> p_player);
      if v_free is null then perform private.fail('draw.team_full', jsonb_build_object('team', p_team)); end if;
      select coalesce(array_agg(x.id), '{}') into v_push from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team
        and x.id <> p_player and x.team_slot > v_free and x.team_slot <= p_slot;
    end if;
  end if;

  v_undo := private.snapshot(p_channel, array[p_player] || v_push);
  update public.players x set status = p_status, team = p_team, sort_key = coalesce(p_key, x.sort_key),
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_player;
  if cardinality(v_push) > 0 then
    update public.players x
    set team_slot = x.team_slot + case when v_free > p_slot then 1 else -1 end, changed_v = b.next_v, changed_by = b.actor
    where x.id = any(v_push);
  end if;
  if p_slot is not null then
    update public.players x set team_slot = p_slot where x.id = p_player;
  end if;
  return private.commit(p_channel, b.next_v, b.actor, 'move_player', p.kick_username,
    jsonb_build_object('status', p_status, 'team', p_team), jsonb_build_object('players', v_undo), p_request_id);
end $$;
revoke execute on function public.move_player(uuid, uuid, text, smallint, uuid, double precision, smallint) from public, anon;
grant execute on function public.move_player(uuid, uuid, text, smallint, uuid, double precision, smallint) to authenticated;

-- Draws, rerolls and Shuffle fill each team from the top: its players take slots 1, 2, 3... in
-- their slot order, with no gaps. Everything else is as 0005.
create or replace function private.commit(p_channel uuid, p_next_v bigint, p_actor text, p_action text,
  p_target text, p_payload jsonb, p_undo jsonb, p_request_id uuid, p_rows jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_act  public.activity;
  v_rows jsonb;
  v_v    bigint;
begin
  if p_action in ('draw_teams', 'reroll', 'shuffle_teams') then
    update public.players p set team_slot = c.n, changed_v = p_next_v, changed_by = p_actor
    from (select x.id, row_number() over (partition by x.team order by x.team_slot nulls last, x.sort_key) n
          from public.players x
          where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing') c
    where p.id = c.id and p.team_slot is distinct from c.n;
  end if;

  insert into public.activity (channel_id, v, actor, action, target, payload, undo, request_id)
  values (p_channel, p_next_v, p_actor, p_action, p_target, coalesce(p_payload, '{}'::jsonb), p_undo, p_request_id)
  returning * into v_act;

  select coalesce(jsonb_agg(private.player_json(p) order by p.joined_at), '[]'::jsonb) into v_rows
  from public.players p where p.channel_id = p_channel and p.changed_v = p_next_v;
  v_rows := v_rows || coalesce(p_rows, '[]'::jsonb)
    || jsonb_build_array((to_jsonb(v_act) - 'undo') || '{"_t":"activity"}'::jsonb);

  v_v := private.emit(p_channel, p_action, v_rows, p_actor);
  if v_v <> p_next_v then raise exception 'version drift: % <> %', v_v, p_next_v; end if;
  return jsonb_build_object('v', v_v, 'kind', p_action, 'rows', v_rows, 'actor', p_actor);
end $$;
revoke execute on function private.commit(uuid, bigint, text, text, text, jsonb, jsonb, uuid, jsonb) from public, anon, authenticated;

-- Undo puts each captured player back in their slot too (queue.restoring keeps the trigger from
-- moving them). Everything else is as 0027.
create or replace function public.undo(p_channel uuid, p_activity bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  a        public.activity;
  v_by     text;
  v_mod    uuid[];
  v_names  text[];
  v_rows   jsonb := '[]'::jsonb;
  v_then   bigint;
  v_games  uuid[];
  v_gnames text[];
begin
  -- Victory with a draw after it wrote two activities; the game's names the draw (then), which
  -- is undone first, in its own write, so the game's players are as the game left them.
  select (x.undo ->> 'then')::bigint into v_then from public.activity x
  where x.id = p_activity and x.channel_id = p_channel and x.undone_at is null;
  if v_then is not null and exists (select 1 from public.activity x
                                    where x.id = v_then and x.undone_at is null and x.undo is not null) then
    perform public.undo(p_channel, v_then, null);
  end if;

  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;

  select * into a from public.activity x where x.id = p_activity and x.channel_id = p_channel for update;
  if not found or a.undo is null or a.undone_at is not null then
    perform private.fail('undo.changed', jsonb_build_object('by', null));
  end if;

  select p.changed_by into v_by from public.players p
  where p.channel_id = p_channel and p.changed_v <> a.v
    and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e
                 union all
                 select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e)
  limit 1;
  if found then perform private.fail('undo.changed', jsonb_build_object('by', v_by)); end if;

  -- Players: restore the captured rows (their old games_played included, so the trigger must
  -- not count the restore) and soft-delete the ones the write inserted.
  perform set_config('queue.restoring', 'on', true);
  begin
    update public.players p set
      status = r.status, team = r.team, locked = r.locked, deleted_at = r.deleted_at,
      kick_username = r.kick_username, riot_id = r.riot_id, puuid = r.puuid,
      games_played = r.games_played, sort_key = coalesce(r.sort_key, p.sort_key), team_slot = r.team_slot,
      changed_v = r.changed_v, changed_by = r.changed_by
    from jsonb_populate_recordset(null::public.players, coalesce(a.undo -> 'players', '[]'::jsonb)) r
    where p.id = r.id and p.channel_id = p_channel;
  exception when unique_violation then
    perform private.fail('queue.duplicate');
  end;
  perform set_config('queue.restoring', 'off', true);
  v_rows := v_rows || coalesce((
    select jsonb_agg(private.player_json(p)) from public.players p
    where p.channel_id = p_channel
      and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e)), '[]'::jsonb);
  update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
  where p.channel_id = p_channel and p.deleted_at is null
    and p.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e);

  -- Moderation: upsert captured rows (brings back a deleted or revoked sanction, or a served
  -- game), delete inserted ones.
  select array_agg(r.id), array_agg(r.kick_username) into v_mod, v_names
  from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r;
  insert into public.moderation
  select r.* from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r
  where r.channel_id = p_channel
  on conflict (id) do update set revoked_at = excluded.revoked_at, games_left = excluded.games_left,
    expires_at = excluded.expires_at;
  with d as (
    delete from public.moderation m
    where m.channel_id = p_channel
      and m.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_moderation', '[]'::jsonb)) e)
    returning m.id, m.kick_username)
  select coalesce(v_mod, '{}') || coalesce(array_agg(d.id), '{}'), coalesce(v_names, '{}') || coalesce(array_agg(d.kick_username), '{}')
  into v_mod, v_names from d;
  if cardinality(v_mod) > 0 then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod, v_names);
  end if;

  -- Perk uses: restore refunds, drop the ones the write consumed.
  update public.perk_uses u set refunded_at = r.refunded_at
  from jsonb_populate_recordset(null::public.perk_uses, coalesce(a.undo -> 'perk_uses', '[]'::jsonb)) r
  where u.id = r.id and u.channel_id = p_channel;
  delete from public.perk_uses u
  where u.channel_id = p_channel
    and u.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_perk_uses', '[]'::jsonb)) e);

  -- Draw: mark it undone; the previous one is the current result again.
  if a.undo ? 'draw' then
    update public.draws d set undone_at = now()
    where d.id = (a.undo ->> 'draw')::uuid and d.channel_id = p_channel;
    v_rows := v_rows || coalesce((
      select jsonb_agg(to_jsonb(d) || '{"_t":"draws"}'::jsonb)
      from public.draws d
      where d.id = (a.undo ->> 'draw')::uuid
         or d.id = (select x.id from public.draws x where x.channel_id = p_channel and x.undone_at is null
                    order by x.created_at desc limit 1)), '[]'::jsonb);
  end if;

  -- Games: a recorded game is removed; a removed or cleared one comes back; a forgotten
  -- person's rows and names come back. Records are recounted for every name involved.
  if a.undo ? 'game' then
    update public.games g set removed_at = now()
    where g.id = (a.undo ->> 'game')::uuid and g.channel_id = p_channel;
    v_games := array[(a.undo ->> 'game')::uuid];
  end if;
  if a.undo ? 'games' then
    select array_agg((e #>> '{}')::uuid) into v_games from jsonb_array_elements(a.undo -> 'games') e;
    update public.games g set removed_at = null where g.channel_id = p_channel and g.id = any(v_games);
  end if;
  if a.undo ? 'game_teams' then
    update public.games g set teams = r.teams
    from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb)
    where g.id = r.id and g.channel_id = p_channel;
    insert into public.game_players
    select r.* from jsonb_populate_recordset(null::public.game_players, a.undo -> 'game_players') r
    where r.channel_id = p_channel
    on conflict do nothing;
    select array_agg(r.id) into v_games from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb);
  end if;
  if v_games is not null then
    select coalesce(array_agg(distinct gp.name), '{}') into v_gnames
    from public.game_players gp where gp.game_id = any(v_games);
    v_rows := v_rows || case when cardinality(v_games) > 20 then jsonb_build_array(jsonb_build_object('_t', 'games_reload'))
                             else coalesce((select jsonb_agg(private.game_json(g)) from public.games g
                                            where g.id = any(v_games)), '[]'::jsonb) end
      || private.recount(p_channel, v_gnames) || jsonb_build_array(private.score(p_channel));
  end if;

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $$;
