-- Several players into one team in one write and one Undo (owner, 2026-09-27: the Pick dialog's
-- "All to Team N"). Those already on that team stay where they are; the rest join it. A team
-- without room for all of them refuses with draw.team_full, and nobody moves.
create function public.move_players(p_channel uuid, p_ids uuid[], p_team smallint, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_ids  uuid[];
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_team is null or p_team not in (1, 2) or p_ids is null or cardinality(p_ids) not between 1 and 10 then
    perform private.fail('request.invalid');
  end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from public.players x
  where x.id = any(p_ids) and x.channel_id = p_channel and x.deleted_at is null
    and not (x.status = 'playing' and x.team = p_team);
  if cardinality(v_ids) = 0 then perform private.fail('request.invalid'); end if;

  if (select count(*) from public.players x
      where x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing' and x.team = p_team)
     + cardinality(v_ids) > (select s.team_size from public.settings s where s.channel_id = p_channel) then
    perform private.fail('draw.team_full', jsonb_build_object('team', p_team));
  end if;

  v_undo := private.snapshot(p_channel, v_ids);
  update public.players x set status = 'playing', team = p_team, changed_v = b.next_v, changed_by = b.actor
  where x.id = any(v_ids);
  return private.commit(p_channel, b.next_v, b.actor, 'move_players', null,
    jsonb_build_object('team', p_team, 'n', cardinality(v_ids)), jsonb_build_object('players', v_undo), p_request_id);
end $$;
revoke execute on function public.move_players(uuid, uuid[], smallint, uuid) from public, anon;
grant execute on function public.move_players(uuid, uuid[], smallint, uuid) to authenticated;
