-- The watch command (owner, 2026-09-29): a sixth channel command, default !izle, that the chat
-- reply answers with the channel's /watch link while the watch page is on. It never reaches
-- ingest_chat; the webhook answers it itself. All six commands must differ.

alter table public.settings add column watch_command text not null default '!izle'
  constraint settings_watch_command_check check (watch_command ~ '^!\S{1,24}$');
alter table public.settings drop constraint settings_check;
alter table public.settings add constraint settings_check
  check (private.all_distinct(array[join_command, leave_command, position_command, perk_command, away_command, watch_command]));

create or replace function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'watch_command',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline', 'after_game', 'games_retention_days',
    'join_open', 'queue_max', 'join_cooldown', 'join_subs_only', 'join_badges']
$$;

-- As 0032, with watch_command.
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
      away_command = v_row.away_command, watch_command = v_row.watch_command, team_size = v_row.team_size,
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

-- As 0023, with the watch command.
create or replace function public.webhook_context(p_broadcaster bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channel_id', c.id,
    'commands', jsonb_build_object('join', s.join_command, 'leave', s.leave_command,
      'position', s.position_command, 'perk', s.perk_command, 'away', s.away_command,
      'watch', s.watch_command),
    'riot', case when s.riot_enabled and s.require_riot_id then s.riot_region end,
    'members', coalesce((select jsonb_object_agg(m.kick_user_id::text,
        jsonb_build_object('source', m.source, 'blocked', m.blocked, 'seen', m.last_seen_at))
      from public.channel_members m where m.channel_id = c.id), '{}'::jsonb))
  from public.channels c join public.settings s on s.channel_id = c.id
  where c.kick_channel_id = p_broadcaster
$$;
