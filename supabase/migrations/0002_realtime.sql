-- Members may receive on ch:<their channel id>. No insert policy: browsers never send.
create policy members_receive_channel on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) ~ '^ch:[0-9a-f-]{36}$'
    and private.member_role(substr((select realtime.topic()), 4)::uuid) is not null
  );

-- One write, one event (spec § Realtime). Call last in every RPC; the send is part of the
-- transaction, so a rolled-back write sends nothing.
create function private.emit(p_channel uuid, p_kind text, p_rows jsonb, p_actor text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_version bigint;
  v_slug    text;
  v_watch   boolean;
begin
  update public.channels set version = version + 1 where id = p_channel
    returning version, slug into v_version, v_slug;
  if v_version is null then
    raise exception 'auth.not_member' using errcode = 'P0001';
  end if;

  perform realtime.send(
    jsonb_build_object('v', v_version, 'kind', p_kind, 'rows', coalesce(p_rows, '[]'::jsonb), 'actor', p_actor),
    'change', 'ch:' || p_channel::text, true);

  select watch_enabled into v_watch from public.settings where channel_id = p_channel;
  if coalesce(v_watch, false) then
    -- Public topics accept messages from anyone, so this carries only a version hint.
    perform realtime.send(jsonb_build_object('v', v_version), 'ping', 'watch:' || v_slug, false);
  end if;
  return v_version;
end $$;
revoke execute on function private.emit(uuid, text, jsonb, text) from public, anon, authenticated;
