-- A gift protects its giver, not its receiver, unless the streamer ticks Gift receiver (spec
-- 2026-11-03 § 1, G1–G7; houstonhub turned protection off because a receiver was saved).
--   G1/G2 perk_refill_on: `gift` now means Gift giver; `gift_receiver` is new. Default
--         {gift,new,renewal}; a row still on 0049's {gift} default moves to it.
--   G3    A live gift receiver's `subscriber` doesn't count for protection unless Gift receiver is
--         ticked. private.badges is unchanged: the subs-only gate and the Sub tag still count it.
--   G5    A named giver is eligible for perk_window_days after a gift, with or without a badge.
--   G6    Every sub event is logged in sub_events, perk on or off, and the giver is recorded.
-- One test, private.perk_eligible, for pick_players, ingest_chat (!perk) and ingest_subscription.
-- Redefined bodies are 0049's; only the perk, recording and retention lines change. Same
-- signatures, and `gift`/`new`/`renewal` stay valid, so the live client and webhook are
-- unaffected and this can be applied before a push (ADR 0084).

alter table public.subscriptions
  add column kind text check (kind in ('new', 'renewal', 'gift')),  -- their own latest event; null: giver only
  add column gifted_at timestamptz;                                   -- the last gift they gave (G5)

create table public.sub_events (
  id           bigint generated always as identity primary key,
  channel_id   uuid not null references public.channels on delete cascade,
  kind         text not null check (kind in ('new', 'renewal', 'gift')),
  user_ids     bigint[] not null,
  usernames    text[] not null,
  gifter_id    bigint,                                               -- null: not a gift, or anonymous
  gifter_name  text,
  expires_at   timestamptz not null,
  received_at  timestamptz not null default now()
);
create index sub_events_channel_received on public.sub_events (channel_id, received_at desc);
alter table public.sub_events enable row level security;  -- no policies: service_role only
revoke all on public.sub_events from anon, authenticated;

alter table public.settings drop constraint settings_perk_refill_on_check;
alter table public.settings add constraint settings_perk_refill_on_check
  check (perk_refill_on <@ array['gift', 'gift_receiver', 'new', 'renewal'] and cardinality(perk_refill_on) <= 4);
alter table public.settings alter column perk_refill_on set default '{gift,new,renewal}';
update public.settings set perk_refill_on = '{gift,new,renewal}' where perk_refill_on = '{gift}';

-- Who protection is for: a perk badge in chat, `subscriber` from a live recorded sub (as
-- private.badges) unless it is an unticked gift receiver's (G3), or a gift given inside the
-- window (G5). One primary-key read each of settings and subscriptions.
create function private.perk_eligible(p_channel uuid, p_kick_user_id bigint, p_badges text[]) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select array_remove(coalesce(p_badges, '{}'), 'subscriber') && s.perk_badges
        or ('subscriber' = any(s.perk_badges)
            and ('subscriber' = any(coalesce(p_badges, '{}')) or x.expires_at > now())
            and not coalesce(x.kind = 'gift' and x.expires_at > now() and 'gift_receiver' <> all(s.perk_refill_on), false))
        or x.gifted_at > now() - make_interval(days => s.perk_window_days)
    from public.settings s
    left join public.subscriptions x on x.channel_id = s.channel_id and x.kick_user_id = p_kick_user_id
    where s.channel_id = p_channel), false)
$$;
revoke execute on function private.perk_eligible(uuid, bigint, text[]) from public, anon, authenticated;

-- One Kick subscription event. Input is checked before any lock or write; the channel lock
-- serialises it with dashboard writes and chat, as ingest_chat. Always recorded (G6); refills by
-- perk_refill_on and returns the refilled players in the queue who the perk is for (S4).
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

  if not s.perk_enabled then return jsonb_build_object('result', 'recorded', 'refilled', '[]'::jsonb); end if;
  v_ids := case when p_kind <> 'gift' then case when p_kind = any(s.perk_refill_on) then p_user_ids else '{}' end
                else case when 'gift_receiver' = any(s.perk_refill_on) then p_user_ids else '{}' end
                  || case when 'gift' = any(s.perk_refill_on) and p_gifter_id is not null then array[p_gifter_id] else '{}' end
           end;
  if cardinality(v_ids) = 0 then return jsonb_build_object('result', 'recorded', 'refilled', '[]'::jsonb); end if;
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

CREATE OR REPLACE FUNCTION public.ingest_chat(p_broadcaster bigint, p_message_id text, p_command text, p_riot_id text, p_sender_id bigint, p_sender_name text, p_badges text[], p_live_gate text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l        record;
  s        public.settings;
  p        public.players;
  v_reason text;
  v_puuid  text;
  v_n      integer;
  v_ev     jsonb;
  v_chan   jsonb;
  v_badges text[];
  v_staff  boolean := p_sender_id = p_broadcaster or 'moderator' = any(coalesce(p_badges, '{}'));
begin
  if p_live_gate is not null and p_live_gate not in ('check', 'confirmed') then perform private.fail('request.invalid'); end if;
  -- Only while live, first pass: an offline join returns before any lock or write, so the webhook
  -- can ask Kick whether a live event was missed. One indexed read; skipped for every other case.
  if p_live_gate = 'check' and p_command = 'join' and not coalesce(v_staff, false) and exists (
       select 1 from public.channels c join public.settings x on x.channel_id = c.id
       where c.kick_channel_id = p_broadcaster and c.live_since is null and x.join_live_only) then
    return jsonb_build_object('result', 'offline');
  end if;
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  if p_command not in ('join', 'leave', 'position', 'perk', 'away') or p_sender_id is null
     or p_sender_name !~ '^\S{1,40}$' or length(p_message_id) not between 1 and 128 then
    perform private.fail('request.invalid');
  end if;
  insert into public.webhook_events (message_id) values (p_message_id) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;

  select * into s from public.settings x where x.channel_id = l.channel_id;
  -- Chat badges plus a recorded sub (0049 S7): the list the join gate and the Sub tag read.
  v_badges := private.badges(l.channel_id, p_sender_id, p_badges);
  update public.channels c set last_command_at = now() where c.id = l.channel_id;
  v_chan := jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', l.channel_id, 'last_command_at', now()));
  select * into p from public.players x
  where x.channel_id = l.channel_id and x.deleted_at is null
    and (x.kick_user_id = p_sender_id or lower(x.kick_username) = lower(p_sender_name))
  order by x.kick_user_id = p_sender_id desc nulls last
  limit 1;

  if p_command = 'join' then
    -- One join per user per 10 s: spam is dropped, not written to the feed.
    if exists (select 1 from public.activity a
               where a.channel_id = l.channel_id and a.created_at > now() - interval '10 seconds'
                 and a.action in ('chat_join', 'chat_rejected')
                 and a.payload ->> 'kick_user_id' = p_sender_id::text) then
      return jsonb_build_object('result', 'ignored', 'reason', 'queue.cooldown');
    end if;
    begin
      -- Second pass (Kick confirmed offline or did not answer): re-checked under the channel lock,
      -- so a live event committed meanwhile wins.
      if p_live_gate = 'confirmed' and s.join_live_only and not coalesce(v_staff, false)
         and (select c.live_since from public.channels c where c.id = l.channel_id) is null then
        perform private.fail('queue.offline');
      end if;
      perform private.join_check(l.channel_id, p_sender_name, p_sender_id, p_riot_id);
      perform private.join_rules(l.channel_id, s, p_sender_name, v_badges, coalesce(v_staff, false));
    exception when sqlstate 'P0001' then
      v_reason := sqlerrm;
    end;
    if v_reason is not null then
      v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_rejected', p_sender_name,
        jsonb_build_object('reason', v_reason, 'kick_user_id', p_sender_id, 'riot_id', p_riot_id), null, null, v_chan);
      return jsonb_build_object('result', 'rejected', 'reason', v_reason, 'v', v_ev -> 'v');
    end if;
    if p_riot_id is not null then
      select r.puuid into v_puuid from public.riot_cache r
      where lower(r.game_name) = lower(split_part(p_riot_id, '#', 1)) and lower(r.tag_line) = lower(split_part(p_riot_id, '#', 2))
        and r.fetched_at > now() - interval '6 hours'
      order by r.fetched_at desc limit 1;
    end if;
    insert into public.players (channel_id, kick_user_id, kick_username, riot_id, puuid, is_subscriber, badges,
      source, changed_v, changed_by)
    values (l.channel_id, p_sender_id, p_sender_name, p_riot_id, v_puuid, 'subscriber' = any(v_badges),
      coalesce(p_badges[1:16], '{}'), 'chat', l.next_v, null)
    returning * into p;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_join', p_sender_name,
      jsonb_build_object('kick_user_id', p_sender_id, 'riot_id', p_riot_id), null, null, v_chan);
    return jsonb_build_object('result', 'joined', 'player', p.id, 'v', v_ev -> 'v',
      'rank_needed', s.riot_enabled and p_riot_id is not null and v_puuid is null);
  end if;

  if p_command = 'leave' then
    if p.id is null then return jsonb_build_object('result', 'none'); end if;
    update public.players x set deleted_at = now(), changed_v = l.next_v, changed_by = null where x.id = p.id;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_leave', p.kick_username,
      jsonb_build_object('kick_user_id', p_sender_id), null, null, v_chan);
    return jsonb_build_object('result', 'left', 'v', v_ev -> 'v');
  end if;

  if p_command = 'away' then
    if p.id is null or p.status in ('playing', 'punished') then return jsonb_build_object('result', 'none'); end if;
    update public.players x set status = case x.status when 'away' then 'waiting' else 'away' end,
      changed_v = l.next_v, changed_by = null
    where x.id = p.id returning * into p;
    v_ev := private.commit(l.channel_id, l.next_v, null, 'chat_away', p.kick_username,
      jsonb_build_object('kick_user_id', p_sender_id, 'status', p.status), null, null, v_chan);
    return jsonb_build_object('result', 'away', 'status', p.status, 'v', v_ev -> 'v');
  end if;

  if p_command = 'position' then
    if p.id is null or p.status <> 'waiting' then return jsonb_build_object('result', 'position', 'position', null); end if;
    select count(*) into v_n from public.players x
    where x.channel_id = l.channel_id and x.deleted_at is null and x.status = 'waiting' and (x.sort_key, x.joined_at) <= (p.sort_key, p.joined_at);
    return jsonb_build_object('result', 'position', 'position', v_n);
  end if;

  -- perk: uses left, only for a sender the perk is for (the same test as pick_players); anyone
  -- else is told who the perk is for. One count: private.perk_left.
  if not private.perk_eligible(l.channel_id, p_sender_id, p_badges) then
    return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', false);
  end if;
  return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', true,
    'left', private.perk_left(l.channel_id, p_sender_id));
end $function$;

CREATE OR REPLACE FUNCTION public.pick_players(p_channel uuid, p_n integer, p_source text, p_base uuid, p_request_id uuid, p_again boolean DEFAULT false, p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b        record;
  s        public.settings;
  v_latest public.draws;
  v_draw   public.draws;
  v_pool   uuid[];
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

  select coalesce(array_agg(p.id order by extensions.gen_random_bytes(8)), '{}') into v_pool
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null
    and p.status = any(case p_source when 'waiting' then array['waiting'] when 'teams' then array['playing']
                                     else array['waiting', 'playing'] end)
    and (p_source <> 'custom' or p.id = any(p_ids))
    and private.sanction(p_channel, p.kick_username, p.kick_user_id) is null;
  v_pick := v_pool[1:p_n];
  if cardinality(v_pick) = 0 then perform private.fail('draw.not_enough'); end if;

  if p_source = 'teams' and s.perk_enabled then
    select coalesce(array_agg(p.id), '{}') into v_prot
    from public.players p
    where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing'
      and p.kick_user_id is not null and private.perk_eligible(p_channel, p.kick_user_id, p.badges)
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
      'source', p_source)
      || case when p_source = 'custom' then jsonb_build_object('pool', to_jsonb(v_pool)) else '{}'::jsonb end,
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
end $function$;

CREATE OR REPLACE FUNCTION private.retention()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ch    uuid;
  v_ids   uuid[];
  v_names text[];
begin
  delete from public.players where deleted_at < now() - interval '10 minutes';
  update public.activity set undo = null where undo is not null and created_at < now() - interval '10 minutes';
  delete from public.draws d
  where d.created_at < now() - interval '24 hours'
    and d.id is distinct from (select x.id from public.draws x
                               where x.channel_id = d.channel_id and x.undone_at is null
                               order by x.created_at desc limit 1);
  delete from public.activity where created_at < now() - interval '30 days';
  delete from public.webhook_events where received_at < now() - interval '1 hour';
  delete from public.perk_uses u using public.settings s
  where s.channel_id = u.channel_id and u.used_at < now() - make_interval(days => s.perk_window_days + 1);
  delete from public.channel_members
  where source = 'badge' and not blocked and coalesce(last_seen_at, created_at) < now() - interval '30 days';
  delete from public.riot_cache where fetched_at < now() - interval '7 days';
  -- 0049: a subscription that no longer counts (ended) nor refills (older than the longest window);
  -- 0050: nor makes its giver eligible.
  delete from public.subscriptions
  where coalesce(expires_at, '-infinity') < now() and coalesce(perk_reset_at, '-infinity') < now() - interval '90 days'
    and coalesce(gifted_at, '-infinity') < now() - interval '90 days';
  delete from public.sub_events where received_at < now() - interval '90 days';
  -- 0027: a removed game once its undo window has passed; a game older than the channel's
  -- retention, recounting the records of the people in it.
  delete from public.games where removed_at < now() - interval '10 minutes';
  for v_ch, v_ids in
    select g.channel_id, array_agg(g.id) from public.games g
    join public.settings s on s.channel_id = g.channel_id
    where g.ended_at < now() - make_interval(days => s.games_retention_days)
    group by g.channel_id
  loop
    select array_agg(distinct gp.name) into v_names from public.game_players gp where gp.game_id = any(v_ids);
    delete from public.games g where g.id = any(v_ids);
    perform private.recount(v_ch, coalesce(v_names, '{}'));
  end loop;
end $function$;

-- Nothing but private.perk_eligible may test a badge list against perk_badges.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private') and p.proname <> 'perk_eligible'
               and p.prosrc ~ '&& s\.perk_badges') then
    raise exception '0050: a function tests perk badges outside private.perk_eligible';
  end if;
end $$;
