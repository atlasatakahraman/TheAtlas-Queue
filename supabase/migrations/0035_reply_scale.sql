-- Chat replies at stream scale (owner, 2026-09-29). commands_list: the !komutlar answer can be
-- switched off. kick_tokens keeps the access token too (encrypted, as the refresh token), so a
-- reply reuses it until it expires; a refresh first claims a 15 s lease, because Kick rotates
-- the refresh token and two refreshes at once would lose it.

alter table public.settings add column commands_list boolean not null default true;
alter table public.kick_tokens add column access_token_enc bytea;
alter table public.kick_tokens add column refreshing_until timestamptz;

create or replace function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'watch_command', 'commands_list',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline', 'after_game', 'games_retention_days',
    'join_open', 'queue_max', 'join_cooldown', 'join_subs_only', 'join_badges']
$$;

-- As 0034, with commands_list.
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
      commands_list = v_row.commands_list,
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

-- The refresh lease: true for the one caller that may refresh now.
create function public.claim_token_refresh(p_channel uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  with c as (
    update public.kick_tokens t set refreshing_until = now() + interval '15 seconds'
    where t.channel_id = p_channel and (t.refreshing_until is null or t.refreshing_until < now())
    returning 1
  )
  select exists (select 1 from c)
$$;
revoke execute on function public.claim_token_refresh(uuid) from public, anon, authenticated;
grant execute on function public.claim_token_refresh(uuid) to service_role;
