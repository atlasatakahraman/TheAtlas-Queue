-- Chat (owner, 2026-11-15, spec § 1d): commands match ignoring case and Turkish letters, each takes
-- up to 5 extra words, every word distinct after folding; the position command answers every
-- state; the picked-names line (chat.picked) joins the relabelable chat keys.

-- C1: the one fold, the same in TS (src/lib/kick-command.ts fold). İ/I/ı are mapped before lower(),
-- so the dotted capital never becomes i + U+0307.
create function private.fold_command(x text) returns text
language sql immutable set search_path = '' as $$
  select lower(translate(x, 'İIıÇçŞşĞğÖöÜü', 'iiiccssggoouu'))
$$;
revoke execute on function private.fold_command(text) from public, anon, authenticated;

-- C2: {"leave": ["!cik", "!exit"], …}, keys among the seven commands, ≤ 5 words each.
create function private.command_words_valid(w jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(w) = 'object' and not exists (
    select 1 from jsonb_each(w) e
    where e.key not in ('join', 'leave', 'position', 'perk', 'away', 'watch', 'rules')
       or jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 5
       or exists (select 1 from jsonb_array_elements(e.value) v
                  where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^!\S{1,24}$'))
$$;
revoke execute on function private.command_words_valid(jsonb) from public, anon, authenticated;

-- C3: no folded word belongs to two commands. p_main is in the order of the keys below. A word
-- repeating its own command (`!cik` beside `!çık`) is redundant, not a clash. Bad shapes are
-- read as empty here; settings_command_words_check rejects them.
create function private.commands_distinct(p_main text[], p_words jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select not exists (
    select 1
    from (select (array['join', 'leave', 'position', 'perk', 'away', 'watch', 'rules'])[m.i] k, m.x
          from unnest(p_main) with ordinality m(x, i)
          union all
          select e.key, v #>> '{}' from jsonb_each(case when jsonb_typeof(p_words) = 'object' then p_words else '{}' end) e,
            jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]' end) v) w
    group by private.fold_command(w.x)
    having count(distinct w.k) > 1)
$$;
revoke execute on function private.commands_distinct(text[], jsonb) from public, anon, authenticated;

alter table public.settings add column command_words jsonb not null default '{}'
  constraint settings_command_words_check check (private.command_words_valid(command_words));
alter table public.settings drop constraint settings_check;
alter table public.settings add constraint settings_check
  check (private.commands_distinct(array[join_command, leave_command, position_command, perk_command, away_command,
    watch_command, rules_command], command_words));

-- C2: the webhook matches any word of a command, main first.
create or replace function public.webhook_context(p_broadcaster bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channel_id', c.id,
    'commands', (select jsonb_object_agg(w.k, jsonb_build_array(w.word) || coalesce(s.command_words -> w.k, '[]'))
                 from (values ('join', s.join_command), ('leave', s.leave_command), ('position', s.position_command),
                              ('perk', s.perk_command), ('away', s.away_command), ('watch', s.watch_command),
                              ('rules', s.rules_command)) w(k, word)),
    'riot', case when s.riot_enabled and s.require_riot_id then s.riot_region end,
    'members', coalesce((select jsonb_object_agg(m.kick_user_id::text,
        jsonb_build_object('source', m.source, 'blocked', m.blocked, 'seen', m.last_seen_at))
      from public.channel_members m where m.channel_id = c.id), '{}'::jsonb))
  from public.channels c join public.settings s on s.channel_id = c.id
  where c.kick_channel_id = p_broadcaster
$$;

-- As 0049, with command_words.
CREATE OR REPLACE FUNCTION private.settings_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'watch_command', 'rules_command', 'command_words', 'rules', 'commands_list',
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
      rules_command = v_row.rules_command, command_words = v_row.command_words,
      rules = v_row.rules, team_size = v_row.team_size,
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

-- As 0050, the position command answering every state (C4).
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
    -- status null: not in the queue. Only a waiting player has a place; a team only while playing.
    if p.id is not null and p.status = 'waiting' then
      select count(*) into v_n from public.players x
      where x.channel_id = l.channel_id and x.deleted_at is null and x.status = 'waiting' and (x.sort_key, x.joined_at) <= (p.sort_key, p.joined_at);
    end if;
    return jsonb_build_object('result', 'position', 'status', p.status, 'position', v_n,
      'team', case when p.status = 'playing' then p.team end);
  end if;

  -- perk: uses left, only for a sender the perk is for (the same test as pick_players); anyone
  -- else is told who the perk is for. One count: private.perk_left.
  if not private.perk_eligible(l.channel_id, p_sender_id, p_badges) then
    return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', false);
  end if;
  return jsonb_build_object('result', 'perk', 'enabled', s.perk_enabled, 'eligible', true,
    'left', private.perk_left(l.channel_id, p_sender_id));
end $function$;

-- As 0052, with the position and picked lines (C6).
create or replace function private.labels_valid(l jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
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
        'chat.rejected.offline', 'chat.rejected.closed', 'chat.position', 'chat.position.team',
        'chat.position.away', 'chat.position.punished', 'chat.position.none', 'chat.picked', 'chat.perk', 'chat.perk.none',
        'chat.perk.saved', 'chat.perk.refilled', 'chat.perk.refunded',
        'chat.commands', 'chat.watch', 'chat.rules'
      ]) then return false; end if;
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 80 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
