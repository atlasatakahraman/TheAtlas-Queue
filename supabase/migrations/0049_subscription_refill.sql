-- Subscribers recognised from Kick's subscription events; a sub event refills protection (spec
-- 2026-10-18 § 4, S1–S7, rewritten 2026-10-19).
--   S1  Official events only. A recorded sub (new / renewal / gifts, expires_at in the future)
--       counts as the `subscriber` badge from the moment it arrives, chatting or not.
--   S7  One check: private.badges feeds the subs-only gate, is_subscriber on join, !perk and
--       protection in Pick from Teams.
--   S2  settings.perk_refill_on chooses which events refill (default: gifts).
--   S3  A refill resets the window (perk_reset_at): uses before it stop counting.
--   S6  On a gift the gifter is refilled too, unless anonymous; only giftees become subscribers.
--   S5  public.subscriptions is service_role only, written only by ingest_subscription.
-- Redefined bodies are the live ones (ingest_chat 0043, pick_players 0047, update_settings and
-- settings_keys 0037, labels_valid 0042); only the badge, perk and settings lines change. Same
-- signatures, so the live client and webhook are unaffected and this can be applied before a push.

create table public.subscriptions (
  channel_id     uuid not null references public.channels on delete cascade,
  kick_user_id   bigint not null,
  expires_at     timestamptz,               -- null: never subscribed through an event (a gifter, S6)
  perk_reset_at  timestamptz,               -- the last refill (S3); null = never
  updated_at     timestamptz not null default now(),
  primary key (channel_id, kick_user_id)
);
alter table public.subscriptions enable row level security;  -- no policies: service_role only (S5)
revoke all on public.subscriptions from anon, authenticated;

alter table public.settings add column perk_refill_on text[] not null default '{gift}'
  check (perk_refill_on <@ array['gift', 'new', 'renewal'] and cardinality(perk_refill_on) <= 3);

CREATE OR REPLACE FUNCTION private.settings_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'watch_command', 'rules_command', 'rules', 'commands_list',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline', 'after_game', 'games_retention_days',
    'join_open', 'queue_max', 'join_cooldown', 'join_subs_only', 'join_badges', 'join_live_only',
    'perk_refill_on']
$function$;

CREATE OR REPLACE FUNCTION public.update_settings(p_channel uuid, p_patch jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b      record;
  v_row  public.settings;
  v_key  text;
  v_c    text;
  v_rows jsonb;
  v_was  boolean;
  v_n    integer := 0;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then perform private.fail('request.invalid'); end if;
  select k into v_key from jsonb_object_keys(p_patch) k where k <> all (private.settings_keys()) limit 1;
  if found then perform private.fail('settings.invalid', jsonb_build_object('field', v_key)); end if;

  select * into v_row from public.settings s where s.channel_id = p_channel;
  v_was := v_row.require_riot_id;
  begin
    v_row := jsonb_populate_record(v_row, p_patch);
    update public.settings s set
      join_command = v_row.join_command, leave_command = v_row.leave_command,
      position_command = v_row.position_command, perk_command = v_row.perk_command,
      away_command = v_row.away_command, watch_command = v_row.watch_command,
      rules_command = v_row.rules_command, rules = v_row.rules, team_size = v_row.team_size,
      riot_enabled = v_row.riot_enabled, require_riot_id = v_row.require_riot_id,
      riot_region = v_row.riot_region, fair_play = v_row.fair_play, draw_reveal = v_row.draw_reveal,
      stream_locale = v_row.stream_locale, watch_enabled = v_row.watch_enabled,
      watch_sections = v_row.watch_sections, chat_replies = v_row.chat_replies,
      commands_list = v_row.commands_list,
      perk_enabled = v_row.perk_enabled, perk_uses = v_row.perk_uses,
      perk_window_days = v_row.perk_window_days, perk_badges = v_row.perk_badges,
      perk_refill_on = v_row.perk_refill_on,
      labels = v_row.labels, clear_on_offline = v_row.clear_on_offline, after_game = v_row.after_game,
      games_retention_days = v_row.games_retention_days,
      join_open = v_row.join_open, queue_max = v_row.queue_max, join_cooldown = v_row.join_cooldown,
      join_subs_only = v_row.join_subs_only, join_badges = v_row.join_badges,
      join_live_only = v_row.join_live_only, updated_at = now()
    where s.channel_id = p_channel
    returning jsonb_build_array(to_jsonb(s) || '{"_t":"settings"}'::jsonb) into v_rows;
  exception
    when check_violation then
      get stacked diagnostics v_c = constraint_name;
      if v_c = 'settings_labels_check' then perform private.fail('settings.label_invalid'); end if;
      perform private.fail('settings.invalid', jsonb_build_object('field',
        case v_c when 'settings_check' then 'commands' else regexp_replace(v_c, '^settings_(.*)_check$', '\1') end));
    when not_null_violation then
      get stacked diagnostics v_c = column_name;
      perform private.fail('settings.invalid', jsonb_build_object('field', v_c));
    when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range
         or invalid_parameter_value or string_data_right_truncation then
      perform private.fail('settings.invalid', jsonb_build_object('field', null));
  end;

  if v_row.require_riot_id and not v_was then
    update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and p.riot_id is null;
    get diagnostics v_n = row_count;
  elsif v_was and not v_row.require_riot_id then
    update public.players p set riot_id = null, puuid = null, changed_v = b.next_v, changed_by = b.actor
    where p.channel_id = p_channel and p.deleted_at is null and (p.riot_id is not null or p.puuid is not null);
    get diagnostics v_n = row_count;
  end if;

  return private.commit(p_channel, b.next_v, b.actor, 'update_settings', null,
    jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k))
      || case when v_n > 0 then jsonb_build_object(case when v_was then 'riot_cleared' else 'riot_removed' end, v_n) else '{}'::jsonb end,
    null, p_request_id, v_rows);
end $function$;

-- Chat badges plus `subscriber` while a recorded sub is live. One primary-key read.
create function private.badges(p_channel uuid, p_kick_user_id bigint, p_badges text[]) returns text[]
language sql stable set search_path = '' as $$
  select case when 'subscriber' = any(coalesce(p_badges, '{}')) or not exists (
           select 1 from public.subscriptions x
           where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id and x.expires_at > now())
         then coalesce(p_badges, '{}')
         else coalesce(p_badges, '{}') || 'subscriber'::text end
$$;
revoke execute on function private.badges(uuid, bigint, text[]) from public, anon, authenticated;

-- Uses since the later of the window's start and the last refill (S3).
create or replace function private.perk_left(p_channel uuid, p_kick_user_id bigint) returns integer
language sql stable set search_path = '' as $$
  select greatest(s.perk_uses - (select count(*)::integer from public.perk_uses u
    where u.channel_id = p_channel and u.kick_user_id = p_kick_user_id and u.refunded_at is null
      and u.used_at > greatest(now() - make_interval(days => s.perk_window_days),
                               coalesce((select x.perk_reset_at from public.subscriptions x
                                         where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id),
                                        '-infinity'))), 0)
  from public.settings s where s.channel_id = p_channel
$$;

-- One Kick subscription event. Input is checked before any lock or write; the channel lock
-- serialises it with dashboard writes and chat, as ingest_chat. Returns the refilled players in
-- the queue who the perk is for, for the chat line (S4).
create function public.ingest_subscription(p_broadcaster bigint, p_message_id text, p_kind text,
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

  insert into public.subscriptions as x (channel_id, kick_user_id, expires_at)
  select l.channel_id, u, p_expires_at from unnest(p_user_ids) u group by u
  on conflict (channel_id, kick_user_id) do update
    set expires_at = greatest(x.expires_at, excluded.expires_at), updated_at = now();
  -- The Sub tag for recipients already in the queue; silent, like refresh_badges.
  update public.players p set is_subscriber = true
  where p.channel_id = l.channel_id and p.deleted_at is null and p.kick_user_id = any(p_user_ids) and not p.is_subscriber;

  if not (s.perk_enabled and p_kind = any(s.perk_refill_on)) then
    return jsonb_build_object('result', 'recorded', 'refilled', '[]'::jsonb);
  end if;
  v_ids := case when p_gifter_id is null then p_user_ids else p_user_ids || p_gifter_id end;
  insert into public.subscriptions as x (channel_id, kick_user_id, perk_reset_at)
  select l.channel_id, u, now() from unnest(v_ids) u group by u
  on conflict (channel_id, kick_user_id) do update set perk_reset_at = now(), updated_at = now();

  select coalesce(jsonb_agg(jsonb_build_object('kick_user_id', p.kick_user_id, 'username', p.kick_username,
                                               'left', private.perk_left(l.channel_id, p.kick_user_id))
                            order by p.sort_key), '[]'::jsonb)
  into v_out
  from public.players p
  where p.channel_id = l.channel_id and p.deleted_at is null and p.status in ('waiting', 'playing')
    and p.kick_user_id = any(v_ids) and private.badges(l.channel_id, p.kick_user_id, p.badges) && s.perk_badges;
  return jsonb_build_object('result', 'refilled', 'refilled', v_out);
end $$;
revoke execute on function public.ingest_subscription(bigint, text, text, bigint[], text[], timestamptz, bigint, text)
  from public, anon, authenticated;
grant execute on function public.ingest_subscription(bigint, text, text, bigint[], text[], timestamptz, bigint, text)
  to service_role;

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
  -- Chat badges plus a recorded sub (0049 S7): the one list every badge test below reads.
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

  -- perk: uses left, only for a sender with one of the perk badges (the same test as
  -- pick_players); anyone else is told who the perk is for. One count: private.perk_left.
  if not v_badges && s.perk_badges then
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
      and p.kick_user_id is not null and private.badges(p_channel, p.kick_user_id, p.badges) && s.perk_badges
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

-- The refill line (S4) can be renamed like the other chat replies.
CREATE OR REPLACE FUNCTION private.labels_valid(l jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare loc text; v jsonb; k text; s jsonb;
begin
  if jsonb_typeof(l) <> 'object' then return false; end if;
  for loc, v in select * from jsonb_each(l) loop
    if loc not in ('en', 'tr') or jsonb_typeof(v) <> 'object' then return false; end if;
    for k, s in select * from jsonb_each(v) loop
      if k <> all (array[
        'brand.subtitle', 'team.1', 'team.2', 'match.vs',
        'queue.title', 'queue.hint', 'queue.empty.title', 'queue.empty.hint',
        'action.add', 'action.draw', 'action.reroll', 'action.pick',
        'watch.title', 'watch.subtitle', 'watch.disabled',
        'overlay.queue.title', 'overlay.draw.title',
        'chat.joined', 'chat.joined.many', 'chat.rejected.banned', 'chat.rejected.duplicate',
        'chat.rejected.offline', 'chat.rejected.closed', 'chat.position', 'chat.perk', 'chat.perk.none',
        'chat.perk.saved', 'chat.perk.refilled',
        'chat.commands', 'chat.watch', 'chat.rules'
      ]) then return false; end if;
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 80 then return false; end if;
    end loop;
  end loop;
  return true;
end $function$;

-- Nothing may still test raw chat badges against a badge list.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private') and p.proname <> 'join_rules'
               and p.prosrc ~ '(p\.badges|p_badges|''\{\}''\)) && s\.(perk|join)_badges') then
    raise exception '0049: a function still reads chat badges without private.badges';
  end if;
end $$;
