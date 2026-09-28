-- August behaviours (D22, Stage 8): the pick reveals back beside Typewriter, the queue cleared
-- when the stream ends, a warning turned into a punishment, a punishment's or ban's length edited.

alter table public.settings drop constraint settings_draw_reveal_check;
alter table public.settings add constraint settings_draw_reveal_check
  check (draw_reveal in ('typewriter', 'cards', 'list', 'wheel', 'none'));
-- On by default, as in August ("Sıra oturumu temizlendi").
alter table public.settings add column clear_on_offline boolean not null default true;

create or replace function private.settings_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['join_command', 'leave_command', 'position_command', 'perk_command', 'away_command',
    'team_size', 'riot_enabled', 'require_riot_id', 'riot_region', 'fair_play', 'draw_reveal',
    'stream_locale', 'watch_enabled', 'watch_sections', 'chat_replies', 'perk_enabled', 'perk_uses',
    'perk_window_days', 'perk_badges', 'labels', 'clear_on_offline']
$$;

create or replace function public.update_settings(p_channel uuid, p_patch jsonb, p_request_id uuid)
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
      labels = v_row.labels, clear_on_offline = v_row.clear_on_offline, updated_at = now()
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

-- The stream ending empties the queue and teams in the same write that records it, undoable like
-- Clear queue; moderation stays. Kick's offline event is the only trigger.
create or replace function public.set_live(p_broadcaster bigint, p_live boolean, p_started_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l      record;
  v_was  timestamptz;
  v_rows jsonb;
  v_ids  uuid[];
  v_undo jsonb;
begin
  select * into l from private.lock_broadcaster(p_broadcaster);
  if l.channel_id is null then return null; end if;
  select c.live_since into v_was from public.channels c where c.id = l.channel_id;
  p_started_at := case when p_live then coalesce(p_started_at, now()) end;
  if v_was is not distinct from p_started_at then return jsonb_build_object('changed', false); end if;

  update public.channels c set live_since = p_started_at where c.id = l.channel_id;
  v_rows := jsonb_build_array(jsonb_build_object('_t', 'channels', 'id', l.channel_id, 'live_since', p_started_at));
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

-- A warning becomes a punishment (August's "Türü Değiştir"): the warning goes, the punishment
-- takes its place, one write and one Undo.
create function public.convert_warning(p_channel uuid, p_id uuid, p_games integer, p_minutes integer,
  p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
  b    record;
  m    public.moderation;
  v_id uuid;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x
  where x.id = p_id and x.channel_id = p_channel and x.kind = 'warn' and x.revoked_at is null;
  if not found then perform private.fail('request.invalid'); end if;
  p_reason := coalesce(btrim(p_reason), '');
  if length(p_reason) > 200
     or (p_games is null) = (p_minutes is null)
     or p_games not between 1 and 10
     or p_minutes not between 1 and 525600 then
    perform private.fail('request.invalid');
  end if;

  delete from public.moderation x where x.id = p_id;
  insert into public.moderation (channel_id, kick_username, kick_user_id, kind, games_left, expires_at, reason, created_by)
  values (p_channel, m.kick_username, m.kick_user_id, 'punish', p_games,
          case when p_minutes is not null then now() + make_interval(mins => p_minutes) end, p_reason, b.actor)
  returning id into v_id;
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'convert_warning', m.kick_username,
    jsonb_build_object('games', p_games, 'minutes', p_minutes),
    jsonb_build_object('players', v_players, 'moderation', jsonb_build_array(to_jsonb(m)),
      'inserted_moderation', jsonb_build_array(v_id)),
    p_request_id, private.moderation_rows(p_channel, array[p_id, v_id], array[m.kick_username]));
end $$;

-- A new length for a punishment (games or minutes) or a ban (days, null for permanent), counted
-- from now (August's "Süreyi Düzenle"). Undo puts the old length back.
create function public.edit_sanction(p_channel uuid, p_id uuid, p_games integer, p_minutes integer, p_days integer,
  p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_players jsonb;
  b record;
  m public.moderation;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  select * into m from public.moderation x
  where x.id = p_id and x.channel_id = p_channel and x.kind in ('punish', 'ban') and x.revoked_at is null;
  if not found then perform private.fail('request.invalid'); end if;
  if m.kind = 'punish' and ((p_games is null) = (p_minutes is null) or p_days is not null
       or p_games not between 1 and 10 or p_minutes not between 1 and 525600)
     or m.kind = 'ban' and (p_games is not null or p_minutes is not null or p_days not between 1 and 3650) then
    perform private.fail('request.invalid');
  end if;

  update public.moderation x set
    games_left = case when m.kind = 'punish' then p_games end,
    expires_at = case
      when p_minutes is not null then now() + make_interval(mins => p_minutes)
      when p_days is not null then now() + make_interval(days => p_days) end
  where x.id = p_id;
  v_players := private.settle(p_channel, b.next_v, b.actor);
  return private.commit(p_channel, b.next_v, b.actor, 'edit_sanction', m.kick_username,
    jsonb_build_object('kind', m.kind, 'games', p_games, 'minutes', p_minutes, 'days', p_days),
    jsonb_build_object('players', v_players, 'moderation', jsonb_build_array(to_jsonb(m))),
    p_request_id, private.moderation_rows(p_channel, array[p_id], array[m.kick_username]));
end $$;

revoke execute on function public.convert_warning(uuid, uuid, integer, integer, text, uuid) from public, anon;
revoke execute on function public.edit_sanction(uuid, uuid, integer, integer, integer, uuid) from public, anon;
grant execute on function public.convert_warning(uuid, uuid, integer, integer, text, uuid) to authenticated;
grant execute on function public.edit_sanction(uuid, uuid, integer, integer, integer, uuid) to authenticated;

-- Undo restores a sanction's end time too (edit_sanction changes it).
create or replace function public.undo(p_channel uuid, p_activity bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  a        public.activity;
  v_by     text;
  v_mod    uuid[];
  v_names  text[];
  v_rows   jsonb := '[]'::jsonb;
begin
  select * into b from private.begin(p_channel, false, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;

  select * into a from public.activity x where x.id = p_activity and x.channel_id = p_channel for update;
  if not found or a.undo is null or a.undone_at is not null then
    perform private.fail('undo.changed', jsonb_build_object('by', null));
  end if;

  select p.changed_by into v_by from public.players p
  where p.channel_id = p_channel and p.changed_v <> a.v
    and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e
                 union all
                 select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e)
  limit 1;
  if found then perform private.fail('undo.changed', jsonb_build_object('by', v_by)); end if;

  -- Players: restore the captured rows (their old games_played included, so the trigger must
  -- not count the restore) and soft-delete the ones the write inserted.
  perform set_config('queue.restoring', 'on', true);
  begin
    update public.players p set
      status = r.status, team = r.team, locked = r.locked, deleted_at = r.deleted_at,
      kick_username = r.kick_username, riot_id = r.riot_id, puuid = r.puuid,
      games_played = r.games_played, sort_key = coalesce(r.sort_key, p.sort_key), changed_v = r.changed_v, changed_by = r.changed_by
    from jsonb_populate_recordset(null::public.players, coalesce(a.undo -> 'players', '[]'::jsonb)) r
    where p.id = r.id and p.channel_id = p_channel;
  exception when unique_violation then
    perform private.fail('queue.duplicate');
  end;
  perform set_config('queue.restoring', 'off', true);
  v_rows := v_rows || coalesce((
    select jsonb_agg(private.player_json(p)) from public.players p
    where p.channel_id = p_channel
      and p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(a.undo -> 'players', '[]'::jsonb)) e)), '[]'::jsonb);
  update public.players p set deleted_at = now(), changed_v = b.next_v, changed_by = b.actor
  where p.channel_id = p_channel and p.deleted_at is null
    and p.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_players', '[]'::jsonb)) e);

  -- Moderation: upsert captured rows (brings back a deleted or revoked sanction, or a served
  -- game), delete inserted ones.
  select array_agg(r.id), array_agg(r.kick_username) into v_mod, v_names
  from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r;
  insert into public.moderation
  select r.* from jsonb_populate_recordset(null::public.moderation, coalesce(a.undo -> 'moderation', '[]'::jsonb)) r
  where r.channel_id = p_channel
  on conflict (id) do update set revoked_at = excluded.revoked_at, games_left = excluded.games_left,
    expires_at = excluded.expires_at;
  with d as (
    delete from public.moderation m
    where m.channel_id = p_channel
      and m.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_moderation', '[]'::jsonb)) e)
    returning m.id, m.kick_username)
  select coalesce(v_mod, '{}') || coalesce(array_agg(d.id), '{}'), coalesce(v_names, '{}') || coalesce(array_agg(d.kick_username), '{}')
  into v_mod, v_names from d;
  if cardinality(v_mod) > 0 then
    v_rows := v_rows || private.moderation_rows(p_channel, v_mod, v_names);
  end if;

  -- Perk uses: restore refunds, drop the ones the write consumed.
  update public.perk_uses u set refunded_at = r.refunded_at
  from jsonb_populate_recordset(null::public.perk_uses, coalesce(a.undo -> 'perk_uses', '[]'::jsonb)) r
  where u.id = r.id and u.channel_id = p_channel;
  delete from public.perk_uses u
  where u.channel_id = p_channel
    and u.id in (select (e #>> '{}')::uuid from jsonb_array_elements(coalesce(a.undo -> 'inserted_perk_uses', '[]'::jsonb)) e);

  -- Draw: mark it undone; the previous one is the current result again.
  if a.undo ? 'draw' then
    update public.draws d set undone_at = now()
    where d.id = (a.undo ->> 'draw')::uuid and d.channel_id = p_channel;
    v_rows := v_rows || coalesce((
      select jsonb_agg(to_jsonb(d) || '{"_t":"draws"}'::jsonb)
      from public.draws d
      where d.id = (a.undo ->> 'draw')::uuid
         or d.id = (select x.id from public.draws x where x.channel_id = p_channel and x.undone_at is null
                    order by x.created_at desc limit 1)), '[]'::jsonb);
  end if;

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $$;
