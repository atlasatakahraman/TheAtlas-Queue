-- Adding at a chosen place (D37, owner 2026-09-27): move_player and add_player take an optional
-- p_key, the queue-order key the client computes as the midpoint between the rows it was dropped
-- or added between (0017's reorder_player). One write, one Undo, instead of a move followed by a
-- reorder. p_key comes last and defaults to null, so every existing call keeps its meaning.

-- Rejects a key that is not a finite number.
create function private.check_key(p_key double precision) returns void
language plpgsql set search_path = '' as $$
begin
  if p_key = 'NaN'::double precision or p_key in ('Infinity', '-Infinity') then
    perform private.fail('request.invalid');
  end if;
end $$;
revoke execute on function private.check_key(double precision) from public, anon, authenticated;

drop function public.add_player(uuid, text, text, uuid);
create function public.add_player(p_channel uuid, p_kick_username text, p_riot_id text, p_request_id uuid,
  p_key double precision default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b    record;
  v_id uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  p_kick_username := btrim(p_kick_username);
  p_riot_id := nullif(btrim(p_riot_id), '');
  if p_kick_username is null or p_kick_username !~ '^\S{1,40}$' then perform private.fail('request.invalid'); end if;
  perform private.check_key(p_key);
  perform private.join_check(p_channel, p_kick_username, null, p_riot_id);

  insert into public.players (channel_id, kick_username, riot_id, source, sort_key, changed_v, changed_by)
  values (p_channel, p_kick_username, p_riot_id, 'manual', coalesce(p_key, extract(epoch from clock_timestamp())), b.next_v, b.actor)
  returning id into v_id;
  return private.commit(p_channel, b.next_v, b.actor, 'add_player', p_kick_username,
    jsonb_build_object('riot_id', p_riot_id),
    jsonb_build_object('inserted_players', jsonb_build_array(v_id)), p_request_id);
end $$;
revoke execute on function public.add_player(uuid, text, text, uuid, double precision) from public, anon;
grant execute on function public.add_player(uuid, text, text, uuid, double precision) to authenticated;

-- Waiting, away, or playing on team 1/2, at p_key in the order when given. A full team refuses
-- with draw.team_full.
drop function public.move_player(uuid, uuid, text, smallint, uuid);
create function public.move_player(p_channel uuid, p_player uuid, p_status text, p_team smallint, p_request_id uuid,
  p_key double precision default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  p      public.players;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_status not in ('waiting', 'playing', 'away')
     or (p_status = 'playing') <> (p_team is not null)
     or (p_team is not null and p_team not in (1, 2)) then
    perform private.fail('request.invalid');
  end if;
  perform private.check_key(p_key);
  select * into p from public.players x where x.id = p_player and x.channel_id = p_channel and x.deleted_at is null;
  if not found then perform private.fail('request.invalid'); end if;

  if p_status = 'playing' and p.team is distinct from p_team
     and (select count(*) from public.players x
          where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
         >= (select s.team_size from public.settings s where s.channel_id = p_channel) then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  v_undo := private.snapshot(p_channel, array[p_player]);
  update public.players x set status = p_status, team = p_team, sort_key = coalesce(p_key, x.sort_key),
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_player;
  return private.commit(p_channel, b.next_v, b.actor, 'move_player', p.kick_username,
    jsonb_build_object('status', p_status, 'team', p_team), jsonb_build_object('players', v_undo), p_request_id);
end $$;
revoke execute on function public.move_player(uuid, uuid, text, smallint, uuid, double precision) from public, anon;
grant execute on function public.move_player(uuid, uuid, text, smallint, uuid, double precision) to authenticated;
