-- Streamer controls (D23, Stage 14): the rules a chat !join must pass. Joining open or closed, a
-- queue limit, subscribers only (by the badge picker's badges), and sitting out N games after
-- playing one. They bind chat only; the streamer and moderators add anyone by hand (owner,
-- 2026-09-28). A refusal is a chat_rejected feed line with its reason, as a ban is.
-- Followers-only is out: Kick's public API cannot check a follow. Contracts: vault
-- stages/2026-09-28-queue-rewrite-stage-14.md.

alter table public.settings add column join_open boolean not null default true;
alter table public.settings add column queue_max smallint not null default 0
  constraint settings_queue_max_check check (queue_max between 0 and 500);
alter table public.settings add column join_cooldown smallint not null default 0
  constraint settings_join_cooldown_check check (join_cooldown between 0 and 20);
alter table public.settings add column join_subs_only boolean not null default false;
alter table public.settings add column join_badges text[] not null default array['subscriber']
  constraint settings_join_badges_check check (cardinality(join_badges) between 1 and 8
    and join_badges <@ array['subscriber', 'vip', 'og', 'founder', 'sub_gifter']);

create or replace function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline', 'after_game', 'games_retention_days',
    'join_open', 'queue_max', 'join_cooldown', 'join_subs_only', 'join_badges']
$$;

-- As 0027, with the five join settings.
create or replace function public.update_settings(p_channel uuid, p_patch jsonb, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
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
      away_command = v_row.away_command, team_size = v_row.team_size,
      riot_enabled = v_row.riot_enabled, require_riot_id = v_row.require_riot_id,
      riot_region = v_row.riot_region, fair_play = v_row.fair_play, draw_reveal = v_row.draw_reveal,
      stream_locale = v_row.stream_locale, watch_enabled = v_row.watch_enabled,
      watch_sections = v_row.watch_sections, chat_replies = v_row.chat_replies,
      perk_enabled = v_row.perk_enabled, perk_uses = v_row.perk_uses,
      perk_window_days = v_row.perk_window_days, perk_badges = v_row.perk_badges,
      labels = v_row.labels, clear_on_offline = v_row.clear_on_offline, after_game = v_row.after_game,
      games_retention_days = v_row.games_retention_days,
      join_open = v_row.join_open, queue_max = v_row.queue_max, join_cooldown = v_row.join_cooldown,
      join_subs_only = v_row.join_subs_only, join_badges = v_row.join_badges, updated_at = now()
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
end $$;

-- The toolbar's Joining button (moderators see the toolbar, so a member RPC, as set_fair_play).
-- In History; no inverse, since pressing again is the undo.
create function public.set_join_open(p_channel uuid, p_open boolean, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_rows jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_open is null then perform private.fail('request.invalid'); end if;
  update public.settings s set join_open = p_open, updated_at = now() where s.channel_id = p_channel
  returning jsonb_build_array(to_jsonb(s) || '{"_t":"settings"}'::jsonb) into v_rows;
  return private.commit(p_channel, b.next_v, b.actor, 'set_join_open', null,
    jsonb_build_object('open', p_open), null, p_request_id, v_rows);
end $$;
revoke execute on function public.set_join_open(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_join_open(uuid, boolean, uuid) to authenticated;

-- A chat join's rules, after join_check (a ban still reads as a ban). p_staff: the streamer or a
-- moderator, who always pass subscribers-only. Sitting out counts the games recorded after the
-- player's last one (by lower-cased name, as game_players keeps it); games taken back do not count.
create function private.join_rules(p_channel uuid, s public.settings, p_name text, p_badges text[], p_staff boolean)
returns void
language plpgsql stable set search_path = '' as $$
declare
  v_last  integer;
  v_after integer;
begin
  if not s.join_open then perform private.fail('queue.closed'); end if;
  if s.join_subs_only and not p_staff and not (coalesce(p_badges, '{}') && s.join_badges) then
    perform private.fail('queue.badge');
  end if;
  if s.join_cooldown > 0 then
    select max(g.n) into v_last from public.game_players gp
    join public.games g on g.id = gp.game_id
    where gp.channel_id = p_channel and gp.name = lower(p_name) and g.removed_at is null;
    if v_last is not null then
      select count(*) into v_after from public.games g
      where g.channel_id = p_channel and g.removed_at is null and g.n > v_last;
      if v_after < s.join_cooldown then perform private.fail('queue.cooldown_games'); end if;
    end if;
  end if;
  if s.queue_max > 0 and (select count(*) from public.players p
                          where p.channel_id = p_channel and p.deleted_at is null and p.status <> 'playing') >= s.queue_max then
    perform private.fail('queue.full');
  end if;
end $$;
revoke execute on function private.join_rules(uuid, public.settings, text, text[], boolean) from public, anon, authenticated;

-- As 0020, with the join rules after join_check.
create or replace function public.ingest_chat(p_broadcaster bigint, p_message_id text, p_command text, p_riot_id text,
  p_sender_id bigint, p_sender_name text, p_badges text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l        record;
  s        public.settings;
  p        public.players;
  v_reason text;
  v_puuid  text;
  v_n      integer;
  v_ev     jsonb;
  v_chan   jsonb;
begin
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  if p_command not in ('join', 'leave', 'position', 'perk', 'away') or p_sender_id is null
     or p_sender_name !~ '^\S{1,40}$' or length(p_message_id) not between 1 and 128 then
    perform private.fail('request.invalid');
  end if;
  insert into public.webhook_events (message_id) values (p_message_id) on conflict do nothing;
  if not found then return jsonb_build_object('result', 'duplicate'); end if;

  select * into s from public.settings x where x.channel_id = l.channel_id;
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
      perform private.join_check(l.channel_id, p_sender_name, p_sender_id, p_riot_id);
      perform private.join_rules(l.channel_id, s, p_sender_name, p_badges,
        p_sender_id = p_broadcaster or 'moderator' = any(coalesce(p_badges, '{}')));
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
    values (l.channel_id, p_sender_id, p_sender_name, p_riot_id, v_puuid, coalesce('subscriber' = any(p_badges), false),
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
    where x.channel_id = l.channel_id and x.deleted_at is null and x.status = 'waiting' and x.joined_at <= p.joined_at;
    return jsonb_build_object('result', 'position', 'position', v_n);
  end if;

  -- perk: uses left in the rolling window.
  select count(*) into v_n from public.perk_uses u
  where u.channel_id = l.channel_id and u.kick_user_id = p_sender_id and u.refunded_at is null
    and u.used_at > now() - make_interval(days => s.perk_window_days);
  return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'left', greatest(s.perk_uses - v_n, 0));
end $$;
