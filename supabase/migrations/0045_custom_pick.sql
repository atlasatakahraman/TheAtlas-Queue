-- Custom pick (spec 2026-10-18 § 3, C1–C4): Pick N at random from a hand-ticked pool. The 0042
-- body with three changes: the source 'custom' and its id list, validated before any read; the
-- pool clause, which keeps the filter every source uses (this channel, not deleted, waiting or
-- playing, no live sanction) and drops a stale id silently, since the browser's pool goes stale by
-- nature (C5); and draws.result.source, recorded for every pick (/watch needs it for custom).
-- Protection stays behind p_source = 'teams' (C4). The trailing default keeps a client still on the
-- old bundle working while a deploy rolls, so this can be applied before its push (0084).
drop function public.pick_players(uuid, integer, text, uuid, uuid, boolean);
create function public.pick_players(p_channel uuid, p_n integer, p_source text, p_base uuid, p_request_id uuid,
  p_again boolean default false, p_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  s        public.settings;
  v_latest public.draws;
  v_draw   public.draws;
  v_pick   uuid[];
  v_out    uuid[] := '{}';
  v_prot   uuid[] := '{}';
  v_stand  uuid[] := '{}';
  v_saved  jsonb := '[]'::jsonb;
  v_hit    uuid;
  v_k      integer := 1;
  v_refund jsonb := '[]'::jsonb;
  v_uses   uuid[];
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  -- 512 = settings.queue_max (≤ 500) plus two teams of ≤ 5: one scan of the channel's rows at most.
  if p_n is null or p_n not between 1 and 10 or p_source is null or p_source not in ('waiting', 'teams', 'all', 'custom')
     or p_again is null
     or (p_source = 'custom' and (p_ids is null or cardinality(p_ids) not between 1 and 512))
     or (p_source <> 'custom' and p_ids is not null) then
    perform private.fail('request.invalid');
  end if;
  v_latest := private.latest_draw(p_channel);
  if v_latest.id is distinct from p_base then return private.stale(p_channel, b.actor, v_latest); end if;
  select * into s from public.settings x where x.channel_id = p_channel;

  -- Pick again (P7): the pick it replaces costs nothing. Undo restores these rows as they were.
  if p_again and v_latest.kind = 'pick' then
    select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_refund
    from public.perk_uses u where u.channel_id = p_channel and u.draw_id = v_latest.id and u.refunded_at is null;
    update public.perk_uses u set refunded_at = now()
    where u.channel_id = p_channel and u.draw_id = v_latest.id and u.refunded_at is null;
  end if;

  select coalesce((array_agg(p.id order by extensions.gen_random_bytes(8)))[1:p_n], '{}') into v_pick
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null
    and p.status = any(case p_source when 'waiting' then array['waiting'] when 'teams' then array['playing']
                                     else array['waiting', 'playing'] end)
    and (p_source <> 'custom' or p.id = any(p_ids))
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null;
  if cardinality(v_pick) = 0 then perform private.fail('draw.not_enough'); end if;

  if p_source = 'teams' and s.perk_enabled then
    select coalesce(array_agg(p.id), '{}') into v_prot
    from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
      and p.kick_user_id is not null and p.badges && s.perk_badges
      and private.perk_left(p_channel, p.kick_user_id) > 0;
    select coalesce(array_agg(p.id order by extensions.gen_random_bytes(8)), '{}') into v_stand
    from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
      and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null
      and p.id <> all (v_pick) and p.id <> all (v_prot);
    foreach v_hit in array v_pick loop
      if v_hit = any(v_prot) then
        v_saved := v_saved || jsonb_build_object(
          'id', v_hit,
          'kick_username', (select p.kick_username from public.players p where p.id = v_hit),
          'standin_id', v_stand[v_k],  -- null past the end: protection holds, the slot goes (P6)
          'left', private.perk_left(p_channel, (select p.kick_user_id from public.players p where p.id = v_hit)) - 1);
        if v_k <= cardinality(v_stand) then
          v_out := v_out || v_stand[v_k];
          v_k := v_k + 1;
        end if;
      else
        v_out := v_out || v_hit;
      end if;
    end loop;
    v_pick := v_out;
  end if;

  insert into public.draws (channel_id, kind, n, result, request_id, created_by)
  values (p_channel, 'pick', p_n,
    jsonb_build_object(
      'picked', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username)
                                           order by array_position(v_pick, p.id)), '[]'::jsonb)
                 from public.players p where p.id = any(v_pick)),
      'saved', v_saved,
      'source', p_source),
    coalesce(p_request_id, gen_random_uuid()), b.actor)
  returning * into v_draw;

  with u as (
    insert into public.perk_uses (channel_id, kick_user_id, draw_id)
    select p_channel, p.kick_user_id, v_draw.id
    from jsonb_array_elements(v_saved) e join public.players p on p.id = (e ->> 'id')::uuid
    returning id)
  select coalesce(array_agg(u.id), '{}') into v_uses from u;

  return private.commit(p_channel, b.next_v, b.actor, 'pick_from_' || p_source, null,
    jsonb_build_object('draw', v_draw.id, 'n', p_n, 'saved', jsonb_array_length(v_saved)),
    jsonb_build_object('inserted_perk_uses', to_jsonb(v_uses), 'perk_uses', v_refund, 'draw', v_draw.id),
    p_request_id, jsonb_build_array(to_jsonb(v_draw) || '{"_t":"draws"}'::jsonb));
end $$;
revoke execute on function public.pick_players(uuid, integer, text, uuid, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.pick_players(uuid, integer, text, uuid, uuid, boolean, uuid[]) to authenticated;
