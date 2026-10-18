-- Replace a team player in their row (spec 2026-10-18 § 2, X1–X5): the incoming waiting player
-- takes the outgoing player's team and slot, and the outgoing player goes to the end of the queue
-- (R1, private.requeue). One write, one Undo. Protection does not apply: the streamer chose this
-- swap (X4). A new function only, so it can be applied before its push (0084).
create function public.replace_player(p_channel uuid, p_out uuid, p_in uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_out  public.players;
  v_in   public.players;
  v_undo jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  -- The channel row lock in begin serialises the dashboard's writes; the rows are locked too, in
  -- id order, against chat intake (!afk, !leave) changing either one mid-swap.
  perform 1 from public.players x where x.id in (p_out, p_in) order by x.id for update;
  select * into v_out from public.players x
  where x.id = p_out and x.channel_id = p_channel and x.deleted_at is null and x.status = 'playing';
  if not found then perform private.fail('request.invalid'); end if;
  select * into v_in from public.players x
  where x.id = p_in and x.channel_id = p_channel and x.deleted_at is null and x.status = 'waiting';
  if not found then perform private.fail('request.invalid'); end if;
  if private.sanction(p_channel, v_in.kick_username, v_in.kick_user_id) is not null then
    perform private.fail('draw.barred', jsonb_build_object('name', v_in.kick_username));
  end if;

  v_undo := private.snapshot(p_channel, array[p_out, p_in]);
  -- Outgoing first: private.team_slot nulls its slot, so the incoming row never shares it.
  update public.players x set status = 'waiting', team = null,
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_out;
  perform private.requeue(array[p_out]);
  update public.players x set status = 'playing', team = v_out.team, team_slot = v_out.team_slot,
    changed_v = b.next_v, changed_by = b.actor
  where x.id = p_in;
  return private.commit(p_channel, b.next_v, b.actor, 'replace_player', v_out.kick_username,
    jsonb_build_object('out', v_out.kick_username, 'in', v_in.kick_username, 'team', v_out.team),
    jsonb_build_object('players', v_undo), p_request_id);
end $$;
revoke execute on function public.replace_player(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_player(uuid, uuid, uuid, uuid) to authenticated;
