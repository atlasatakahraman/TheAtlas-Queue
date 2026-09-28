-- The top bar's Live / Offline (D25, Stage 9) shows the stream title in its tooltip: Kick's
-- livestream.status.updated carries it, so set_live stores it with live_since.

alter table public.channels add column stream_title text check (length(stream_title) <= 200);

drop function public.set_live(bigint, boolean, timestamptz);

create function public.set_live(p_broadcaster bigint, p_live boolean, p_started_at timestamptz,
  p_title text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l       record;
  v_was   timestamptz;
  v_rows  jsonb;
  v_ids   uuid[];
  v_undo  jsonb;
  v_title text := case when p_live then left(nullif(btrim(p_title), ''), 200) end;
begin
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  select c.live_since into v_was from public.channels c where c.id = l.channel_id;
  p_started_at := case when p_live then coalesce(p_started_at, now()) end;
  if v_was is not distinct from p_started_at then return jsonb_build_object('changed', false); end if;

  update public.channels c set live_since = p_started_at, stream_title = v_title where c.id = l.channel_id;
  v_rows := jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', l.channel_id, 'live_since', p_started_at,
    'stream_title', v_title));
  if p_live then
    with r as (
      update public.players x set games_played = 0
      where x.channel_id = l.channel_id and x.deleted_at is null and x.games_played > 0
      returning x.*)
    select v_rows || coalesce(jsonb_agg(private.player_json(r::public.players)), '[]'::jsonb) into v_rows from r;
  elsif (select s.clear_on_offline from public.settings s where s.channel_id = l.channel_id) then
    select array_agg(p.id) into v_ids from public.players p where p.channel_id = l.channel_id and p.deleted_at is null;
    if v_ids is not null then
      v_undo := jsonb_build_object('players', private.snapshot(l.channel_id, v_ids));
      update public.players p set deleted_at = now(), changed_v = l.next_v, changed_by = null where p.id = any(v_ids);
    end if;
  end if;
  perform private.commit(l.channel_id, l.next_v, null, case when p_live then 'stream_live' else 'stream_offline' end,
    null, case when v_ids is not null then jsonb_build_object('count', cardinality(v_ids)) else '{}'::jsonb end,
    v_undo, null, v_rows);
  return jsonb_build_object('changed', true);
end $$;

revoke execute on function public.set_live(bigint, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_live(bigint, boolean, timestamptz, text) to service_role;
