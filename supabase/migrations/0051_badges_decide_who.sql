-- Badges decide who can use protection; refill decides which events give it back (spec 2026-11-03
-- § 1b, B1–B5, owner after Stage 1 shipped). 0050 mixed them: Gift receiver sat under refill but
-- decided who qualifies, and a recent giver was protected with Sub gifter unticked.
--   B1  perk_refill_on is gift / new / renewal. A gift refills everyone in it; the badges decide
--       who can use it.
--   B2  perk_badges gains `sub_receiver`: a live recorded gifted sub qualifies only when ticked.
--   B3  `sub_gifter` covers Kick's chat badge and a recorded gift within perk_window_days.
--   B4  Rows that ticked gift_receiver get sub_receiver instead; other rows keep their badges.
--   B5  private.badges (subs-only gate, Sub tag) is unchanged.
-- Same signatures, so this can be applied before the push (ADR 0084). Until the push, the live
-- client's Gift receiver box is refused (check_violation → settings.invalid); nothing else it sends
-- changes meaning.

update public.settings
set perk_badges = case when 'sub_receiver' = any(perk_badges) then perk_badges else perk_badges || 'sub_receiver'::text end,
    perk_refill_on = array_remove(perk_refill_on, 'gift_receiver')
where 'gift_receiver' = any(perk_refill_on);
alter table public.settings drop constraint settings_perk_refill_on_check;
alter table public.settings add constraint settings_perk_refill_on_check
  check (perk_refill_on <@ array['gift', 'new', 'renewal'] and cardinality(perk_refill_on) <= 3);
alter table public.settings alter column perk_badges set default '{subscriber,sub_gifter}';

-- Who protection is for: a perk badge in chat; `subscriber` for a sub of their own (or a chat
-- badge with no recorded gift); `sub_receiver` for a live recorded gift; `sub_gifter` also for a
-- gift given inside the window. One primary-key read each of settings and subscriptions.
create or replace function private.perk_eligible(p_channel uuid, p_kick_user_id bigint, p_badges text[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select array_remove(array_remove(coalesce(p_badges, '{}'), 'subscriber'), 'sub_receiver') && s.perk_badges
        or case when x.kind = 'gift' and x.expires_at > now() then 'sub_receiver' = any(s.perk_badges)
                else 'subscriber' = any(s.perk_badges)
                     and ('subscriber' = any(coalesce(p_badges, '{}')) or x.expires_at > now()) end
        or ('sub_gifter' = any(s.perk_badges) and x.gifted_at > now() - make_interval(days => s.perk_window_days))
    from public.settings s
    left join public.subscriptions x on x.channel_id = s.channel_id and x.kick_user_id = p_kick_user_id
    where s.channel_id = p_channel), false)
$$;

-- 0050's body; only the refill set changes (B1).
create or replace function public.ingest_subscription(p_broadcaster bigint, p_message_id text, p_kind text,
  p_user_ids bigint[], p_usernames text[], p_expires_at timestamptz,
  p_gifter_id bigint default null, p_gifter_name text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l     record;
  s     public.settings;
  v_ids bigint[];
  v_out jsonb;
begin
  if p_kind is null or p_kind not in ('gift', 'new', 'renewal')
     or p_message_id is null or length(p_message_id) not between 1 and 128
     or coalesce(cardinality(p_user_ids), 0) not between 1 and 100
     or cardinality(p_usernames) is distinct from cardinality(p_user_ids)
     or array_position(p_user_ids, null) is not null
     or exists (select 1 from unnest(p_usernames) u where u is null or u !~ '^\S{1,40}$')
     or p_expires_at is null or p_expires_at not between now() and now() + interval '1 year'
     or (p_gifter_id is null) <> (p_gifter_name is null)
     or (p_gifter_id is not null and (p_kind <> 'gift' or p_gifter_name !~ '^\S{1,40}$')) then
    perform private.fail('request.invalid');
  end if;
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  insert into public.webhook_events (message_id) values (p_message_id) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;
  select * into s from public.settings x where x.channel_id = l.channel_id;

  insert into public.sub_events (channel_id, kind, user_ids, usernames, gifter_id, gifter_name, expires_at)
  values (l.channel_id, p_kind, p_user_ids, p_usernames, p_gifter_id, p_gifter_name, p_expires_at);
  insert into public.subscriptions as x (channel_id, kick_user_id, expires_at, kind)
  select l.channel_id, u, p_expires_at, p_kind from unnest(p_user_ids) u group by u
  on conflict (channel_id, kick_user_id) do update
    set expires_at = greatest(x.expires_at, excluded.expires_at), kind = excluded.kind, updated_at = now();
  if p_gifter_id is not null then
    insert into public.subscriptions as x (channel_id, kick_user_id, gifted_at)
    values (l.channel_id, p_gifter_id, now())
    on conflict (channel_id, kick_user_id) do update set gifted_at = now(), updated_at = now();
  end if;
  -- The Sub tag for recipients already in the queue; silent, like refresh_badges.
  update public.players p set is_subscriber = true
  where p.channel_id = l.channel_id and p.deleted_at is null and p.kick_user_id = any(p_user_ids) and not p.is_subscriber;

  if not (s.perk_enabled and p_kind = any(s.perk_refill_on)) then
    return jsonb_build_object('result', 'recorded', 'refilled', '[]'::jsonb);
  end if;
  v_ids := p_user_ids || case when p_gifter_id is not null then array[p_gifter_id] else '{}' end;
  update public.subscriptions x set perk_reset_at = now(), updated_at = now()
  where x.channel_id = l.channel_id and x.kick_user_id = any(v_ids);

  select coalesce(jsonb_agg(jsonb_build_object('kick_user_id', p.kick_user_id, 'username', p.kick_username,
                                               'left', private.perk_left(l.channel_id, p.kick_user_id))
                            order by p.sort_key), '[]'::jsonb)
  into v_out
  from public.players p
  where p.channel_id = l.channel_id and p.deleted_at is null and p.status in ('waiting', 'playing')
    and p.kick_user_id = any(v_ids) and private.perk_eligible(l.channel_id, p.kick_user_id, p.badges);
  return jsonb_build_object('result', 'refilled', 'refilled', v_out);
end $$;
