-- Clear the History tab (owner, 2026-09-28), owner only, like Clear sanctions. The feed is also
-- the undo stack, so nothing before the clear can be undone after it, and the clear itself has
-- no Undo. Its own line is the one row left; clients drop everything older when it arrives.
create function public.clear_history(p_channel uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b   record;
  v_n integer;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  delete from public.activity a where a.channel_id = p_channel;
  get diagnostics v_n = row_count;
  if v_n = 0 then perform private.fail('history.empty'); end if;
  return private.commit(p_channel, b.next_v, b.actor, 'clear_history', null,
    jsonb_build_object('n', v_n), null, p_request_id);
end $$;
revoke execute on function public.clear_history(uuid, uuid) from public, anon;
grant execute on function public.clear_history(uuid, uuid) to authenticated;
