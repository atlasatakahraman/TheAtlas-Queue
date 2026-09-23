-- Owner-only RPCs: settings and membership. A moderator calling any of them gets auth.role.

-- Settings keys a patch may carry: every column but the key and the timestamp.
create function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels']
$$;
revoke execute on function private.settings_keys() from public, anon, authenticated;

-- Partial update: p_patch holds only the keys that change. A bad label is
-- settings.label_invalid; any other rejected value is settings.invalid with {"field": …}
-- (the five commands clashing is field "commands"), for an inline error under that field.
create function public.update_settings(p_channel uuid, p_patch jsonb, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_row  public.settings;
  v_key  text;
  v_c    text;
  v_rows jsonb;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then perform private.fail('request.invalid'); end if;
  select k into v_key from jsonb_object_keys(p_patch) k where k <> all (private.settings_keys()) limit 1;
  if found then perform private.fail('settings.invalid', jsonb_build_object('field', v_key)); end if;

  select * into v_row from public.settings s where s.channel_id = p_channel;
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
      labels = v_row.labels, updated_at = now()
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

  return private.commit(p_channel, b.next_v, b.actor, 'update_settings', null,
    jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)), null, p_request_id, v_rows);
end $$;

-- Add a moderator ahead of time (the Kick user id is resolved from the username server-side
-- first), or turn a badge-granted one into a manual one.
create function public.add_member(p_channel uuid, p_kick_user_id bigint, p_kick_username text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  v_name text;
  v_rows jsonb;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_kick_user_id is null then perform private.fail('request.invalid'); end if;
  v_name := private.target_name(p_kick_username);
  if exists (select 1 from public.channel_members m
             where m.channel_id = p_channel and m.kick_user_id = p_kick_user_id and m.role = 'owner') then
    perform private.fail('auth.role');
  end if;

  insert into public.channel_members as m (channel_id, kick_user_id, kick_username, role, source, added_by)
  values (p_channel, p_kick_user_id, v_name, 'mod', 'manual',
          (select p.kick_user_id from public.profiles p where p.id = (select auth.uid())))
  on conflict (channel_id, kick_user_id) do update
    set source = 'manual', kick_username = excluded.kick_username, added_by = excluded.added_by
  returning jsonb_build_array(to_jsonb(m) || '{"_t":"channel_members"}'::jsonb) into v_rows;
  return private.commit(p_channel, b.next_v, b.actor, 'add_member', v_name, '{}'::jsonb, null, p_request_id, v_rows);
end $$;

-- Block beats the badge: a blocked member has no access however they are marked in chat.
create function public.set_member_blocked(p_channel uuid, p_kick_user_id bigint, p_blocked boolean, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      record;
  m      public.channel_members;
  v_rows jsonb;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if p_blocked is null then perform private.fail('request.invalid'); end if;
  select * into m from public.channel_members x where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id;
  if not found then perform private.fail('request.invalid'); end if;
  if m.role = 'owner' then perform private.fail('auth.role'); end if;

  update public.channel_members x set blocked = p_blocked
  where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id
  returning jsonb_build_array(to_jsonb(x) || '{"_t":"channel_members"}'::jsonb) into v_rows;
  return private.commit(p_channel, b.next_v, b.actor, 'set_member_blocked', m.kick_username,
    jsonb_build_object('blocked', p_blocked), null, p_request_id, v_rows);
end $$;

-- Remove access. A badge-granted moderator gets it back with their next chat line; block
-- them to keep them out.
create function public.remove_member(p_channel uuid, p_kick_user_id bigint, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  m public.channel_members;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.channel_members x where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id;
  if not found then perform private.fail('request.invalid'); end if;
  if m.role = 'owner' then perform private.fail('auth.role'); end if;

  delete from public.channel_members x where x.channel_id = p_channel and x.kick_user_id = p_kick_user_id;
  return private.commit(p_channel, b.next_v, b.actor, 'remove_member', m.kick_username, '{}'::jsonb, null, p_request_id,
    jsonb_build_array(jsonb_build_object('_t', 'channel_members', 'kick_user_id', p_kick_user_id, '_deleted', true)));
end $$;

revoke execute on function public.update_settings(uuid, jsonb, uuid) from public, anon;
revoke execute on function public.add_member(uuid, bigint, text, uuid) from public, anon;
revoke execute on function public.set_member_blocked(uuid, bigint, boolean, uuid) from public, anon;
revoke execute on function public.remove_member(uuid, bigint, uuid) from public, anon;
grant execute on function public.update_settings(uuid, jsonb, uuid) to authenticated;
grant execute on function public.add_member(uuid, bigint, text, uuid) to authenticated;
grant execute on function public.set_member_blocked(uuid, bigint, boolean, uuid) to authenticated;
grant execute on function public.remove_member(uuid, bigint, uuid) to authenticated;
