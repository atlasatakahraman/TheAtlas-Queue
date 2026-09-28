-- Stage 13: overlays (D29, ADR 0045, 0054). Several per channel, each its own URL with a random
-- 128-bit key; only the owner reads a key (moderators never: overlays are not in the members'
-- store or events). The public page reads its data through overlay_snapshot(key), a whitelist
-- of the widgets the overlay shows, on the server only.

create table public.overlays (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  key        text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  name       text not null check (length(btrim(name)) between 1 and 40),
  config     jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index overlays_by_channel on public.overlays (channel_id) where deleted_at is null;
alter table public.overlays enable row level security;
-- The owner reads; every write goes through the definer functions below.
create policy owner_reads_overlays on public.overlays for select to authenticated
  using (private.member_role(channel_id) = 'owner');
revoke all on public.overlays from anon;
revoke insert, update, delete on public.overlays from authenticated;

-- The widgets, in their default order. An overlay lists all of them, in its order, each on or off.
create function private.overlay_default() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('type', 'teams', 'on', true), jsonb_build_object('type', 'score', 'on', true),
      jsonb_build_object('type', 'reveal', 'on', true), jsonb_build_object('type', 'queue', 'on', false),
      jsonb_build_object('type', 'last', 'on', false), jsonb_build_object('type', 'wins', 'on', false),
      jsonb_build_object('type', 'respect', 'on', false)),
    'anchor', 'top-left', 'size', 'm', 'theme', 'ink', 'background', 'transparent', 'lang', null,
    'queue_rows', 5, 'board_rows', 5, 'min_games', 3, 'board_period', 'stream')
$$;

-- A config as sent, over the defaults (unknown keys dropped), or settings.invalid {field}.
create function private.overlay_config(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  d jsonb := private.overlay_default();
  v jsonb;
  f text;
begin
  if jsonb_typeof(p) is distinct from 'object' then perform private.fail('settings.invalid', jsonb_build_object('field', 'config')); end if;
  select d || coalesce(jsonb_object_agg(k, x), '{}'::jsonb) into v from jsonb_each(p) e(k, x) where d ? k;
  f := case
    -- CASE checks in order, so the array functions only ever see an array of objects.
    when jsonb_typeof(v -> 'widgets') <> 'array'
      or exists (select 1 from jsonb_array_elements(v -> 'widgets') w where jsonb_typeof(w) <> 'object') then 'widgets'
    when (select array_agg(w ->> 'type' order by w ->> 'type') from jsonb_array_elements(v -> 'widgets') w)
         is distinct from array['last', 'queue', 'respect', 'reveal', 'score', 'teams', 'wins']
      or exists (select 1 from jsonb_array_elements(v -> 'widgets') w where coalesce(jsonb_typeof(w -> 'on'), '') <> 'boolean') then 'widgets'
    when v ->> 'anchor' is null or v ->> 'anchor' not in ('top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right') then 'anchor'
    when v ->> 'size' is null or v ->> 'size' not in ('s', 'm', 'l') then 'size'
    when v ->> 'theme' is null or v ->> 'theme' not in ('ink', 'paper') then 'theme'
    when v ->> 'background' is null or v ->> 'background' not in ('transparent', 'solid') then 'background'
    when jsonb_typeof(v -> 'lang') <> 'null' and v ->> 'lang' not in ('en', 'tr') then 'lang'
    when v -> 'queue_rows' not in ('5', '10', '15') then 'queue_rows'
    when v -> 'board_rows' not in ('3', '5', '10') then 'board_rows'
    when jsonb_typeof(v -> 'min_games') <> 'number' or (v ->> 'min_games')::numeric not in (0, 1, 3, 5, 10, 20) then 'min_games'
    when v ->> 'board_period' is null or v ->> 'board_period' not in ('stream', 'all') then 'board_period'
  end;
  if f is not null then perform private.fail('settings.invalid', jsonb_build_object('field', f)); end if;
  -- Each widget as {type, on} only.
  return jsonb_set(v, '{widgets}', (select jsonb_agg(jsonb_build_object('type', w ->> 'type', 'on', (w ->> 'on')::boolean) order by i)
                                    from jsonb_array_elements(v -> 'widgets') with ordinality x(w, i)));
end $$;

create function private.overlay_name(p text) returns text
language plpgsql set search_path = '' as $$
begin
  if p is null or length(btrim(p)) not between 1 and 40 then
    perform private.fail('settings.invalid', jsonb_build_object('field', 'name'));
  end if;
  return btrim(p);
end $$;

create function private.overlay_of(p_channel uuid, p_id uuid) returns public.overlays
language plpgsql set search_path = '' as $$
declare
  o public.overlays;
begin
  select * into o from public.overlays x where x.id = p_id and x.channel_id = p_channel and x.deleted_at is null for update;
  if not found then perform private.fail('overlay.not_found'); end if;
  return o;
end $$;

-- New overlay (owner only), up to 20 a channel. The History line names it; deleting it is the undo.
create function public.create_overlay(p_channel uuid, p_name text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  o public.overlays;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  if (select count(*) from public.overlays x where x.channel_id = p_channel and x.deleted_at is null) >= 20 then
    perform private.fail('overlay.limit');
  end if;
  insert into public.overlays (channel_id, name, config)
  values (p_channel, private.overlay_name(p_name), private.overlay_default()) returning * into o;
  return private.commit(p_channel, b.next_v, b.actor, 'create_overlay', o.name, jsonb_build_object('id', o.id), null, p_request_id)
    || jsonb_build_object('overlay', o.id);
end $$;

-- Name and config (owner only). Not in History: the builder saves each switch as it flips. The
-- empty change event bumps the version, so the overlay's ping arrives.
create function public.update_overlay(p_channel uuid, p_id uuid, p_name text, p_config jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  o public.overlays;
  v bigint;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  o := private.overlay_of(p_channel, p_id);
  update public.overlays x set
    name = case when p_name is null then x.name else private.overlay_name(p_name) end,
    config = case when p_config is null then x.config else private.overlay_config(p_config) end,
    updated_at = now()
  where x.id = o.id;
  v := private.emit(p_channel, 'update_overlay', '[]'::jsonb, b.actor);
  return jsonb_build_object('v', v, 'kind', 'update_overlay', 'rows', '[]'::jsonb, 'actor', b.actor);
end $$;

-- A new key (owner only); the old URL stops at once. No undo (ADR 0054): the dashboard asks for
-- the overlay's name first.
create function public.rotate_overlay_key(p_channel uuid, p_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  o public.overlays;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  o := private.overlay_of(p_channel, p_id);
  update public.overlays x set key = encode(extensions.gen_random_bytes(16), 'hex'), updated_at = now() where x.id = o.id;
  return private.commit(p_channel, b.next_v, b.actor, 'rotate_overlay_key', o.name, jsonb_build_object('id', o.id), null, p_request_id);
end $$;

-- Delete (owner only), undoable: Undo brings it back with its key.
create function public.delete_overlay(p_channel uuid, p_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  o public.overlays;
begin
  select * into b from private.begin(p_channel, true, p_request_id);
  if b.replay then return private.replay(p_channel, b.actor); end if;
  o := private.overlay_of(p_channel, p_id);
  update public.overlays x set deleted_at = now() where x.id = o.id;
  return private.commit(p_channel, b.next_v, b.actor, 'delete_overlay', o.name, jsonb_build_object('id', o.id),
    jsonb_build_object('overlay', o.id), p_request_id);
end $$;

revoke execute on function private.overlay_default() from public, anon, authenticated;
revoke execute on function private.overlay_config(jsonb) from public, anon, authenticated;
revoke execute on function private.overlay_name(text) from public, anon, authenticated;
revoke execute on function private.overlay_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_overlay(uuid, text, uuid) from public, anon;
revoke execute on function public.update_overlay(uuid, uuid, text, jsonb, uuid) from public, anon;
revoke execute on function public.rotate_overlay_key(uuid, uuid, uuid) from public, anon;
revoke execute on function public.delete_overlay(uuid, uuid, uuid) from public, anon;
grant execute on function public.create_overlay(uuid, text, uuid) to authenticated;
grant execute on function public.update_overlay(uuid, uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.rotate_overlay_key(uuid, uuid, uuid) to authenticated;
grant execute on function public.delete_overlay(uuid, uuid, uuid) to authenticated;

-- One write, one event, as 0002; the public ping also goes out while the channel has an overlay,
-- whose page listens on the same watch:<slug> topic (it carries only the version).
create or replace function private.emit(p_channel uuid, p_kind text, p_rows jsonb, p_actor text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_version bigint;
  v_slug    text;
  v_watch   boolean;
begin
  update public.channels set version = version + 1 where id = p_channel
    returning version, slug into v_version, v_slug;
  if v_version is null then
    raise exception 'auth.not_member' using errcode = 'P0001';
  end if;

  perform realtime.send(
    jsonb_build_object('v', v_version, 'kind', p_kind, 'rows', coalesce(p_rows, '[]'::jsonb), 'actor', p_actor),
    'change', 'ch:' || p_channel::text, true);

  select watch_enabled into v_watch from public.settings where channel_id = p_channel;
  if coalesce(v_watch, false)
     or exists (select 1 from public.overlays o where o.channel_id = p_channel and o.deleted_at is null) then
    -- Public topics accept messages from anyone, so this carries only a version hint.
    perform realtime.send(jsonb_build_object('v', v_version), 'ping', 'watch:' || v_slug, false);
  end if;
  return v_version;
end $$;
revoke execute on function private.emit(uuid, text, jsonb, text) from public, anon, authenticated;

-- A name as the streamer's chat wrote it: game_players keeps it lower-cased, so the casing comes
-- from the queue, else the latest game that names it (as 0029's board).
create function private.shown_name(p_channel uuid, p_name text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select p.kick_username from public.players p where p.channel_id = p_channel and lower(p.kick_username) = p_name limit 1),
    (select e ->> 'kick_username' from public.games g, jsonb_array_elements(g.teams -> 0 || g.teams -> 1) e
     where g.channel_id = p_channel and lower(e ->> 'kick_username') = p_name order by g.n desc limit 1),
    p_name)
$$;
revoke execute on function private.shown_name(uuid, text) from public, anon, authenticated;

-- What /overlay/<key> and /api/overlay/<key> show: the overlay's config and, for each widget it
-- has on, only that widget's data. Kick names, team numbers and counts; never Kick or Riot ids,
-- ranks, reasons or who did what. Null for an unknown (or rotated, or deleted) key.
create function public.overlay_snapshot(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  o public.overlays;
  c public.channels;
  s public.settings;
  v_on text[];
  v_since timestamptz;
begin
  if p_key !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into o from public.overlays x where x.key = p_key and x.deleted_at is null;
  if not found then return null; end if;
  select * into c from public.channels where id = o.channel_id;
  select * into s from public.settings where channel_id = c.id;
  select array_agg(w ->> 'type') into v_on from jsonb_array_elements(o.config -> 'widgets') w where (w ->> 'on')::boolean;
  v_on := coalesce(v_on, '{}');
  v_since := case when o.config ->> 'board_period' = 'stream' then private.session_start(c.id) end;

  return jsonb_build_object(
    'v', c.version,
    'slug', c.slug,
    'config', o.config,
    'lang', coalesce(o.config ->> 'lang', s.stream_locale),
    'labels', s.labels,
    'team_size', s.team_size,
    'teams', case when 'teams' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'team', p.team,
                'team_slot', p.team_slot, 'locked', p.locked) order by p.team, p.team_slot nulls last, p.sort_key), '[]'::jsonb)
       from public.players p where p.channel_id = c.id and p.deleted_at is null and p.status = 'playing') end,
    'queue', case when 'queue' = any(v_on) then jsonb_build_object(
      'total', (select count(*) from public.players p where p.channel_id = c.id and p.deleted_at is null and p.status = 'waiting'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kick_username', x.kick_username) order by x.sort_key, x.joined_at), '[]'::jsonb)
               from (select p.id, p.kick_username, p.sort_key, p.joined_at from public.players p
                     where p.channel_id = c.id and p.deleted_at is null and p.status = 'waiting'
                     order by p.sort_key, p.joined_at limit (o.config ->> 'queue_rows')::int) x)) end,
    'score', case when 'score' = any(v_on) then private.score(c.id) - '_t' - 'since' end,
    'last', case when 'last' = any(v_on) then
      (select jsonb_build_object('n', g.n, 'winner', g.winner, 'ended_at', g.ended_at,
         'teams', (select jsonb_agg((select coalesce(jsonb_agg(e -> 'kick_username'), '[]'::jsonb)
                                     from jsonb_array_elements(t) e where not e ? 'removed') order by i)
                   from jsonb_array_elements(g.teams) with ordinality x(t, i)))
       from public.games g where g.channel_id = c.id and g.removed_at is null order by g.n desc limit 1) end,
    'wins', case when 'wins' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', private.shown_name(c.id, r.name), 'wins', r.w, 'games', r.n)
                order by r.w desc, r.w::numeric / r.n desc, r.n, r.name), '[]'::jsonb)
       from (select gp.name, count(*) filter (where gp.won) w, count(*) n
             from public.game_players gp join public.games g on g.id = gp.game_id
             where gp.channel_id = c.id and g.removed_at is null and (v_since is null or g.ended_at >= v_since)
             group by gp.name
             having count(*) filter (where gp.won) > 0 and count(*) >= greatest((o.config ->> 'min_games')::int, 1)
             order by count(*) filter (where gp.won) desc, (count(*) filter (where gp.won))::numeric / count(*) desc, count(*), gp.name
             limit (o.config ->> 'board_rows')::int) r) end,
    -- Only the most respected (D29): the top of the board, never its bottom.
    'respect', case when 'respect' = any(v_on) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', private.shown_name(c.id, r.name), 'respect', r.respect, 'games', r.n)
                order by r.respect desc, r.n desc, r.name), '[]'::jsonb)
       from (select x.name, x.n, private.respect(c.id, x.name) respect
             from (select gp.name, count(*) n from public.game_players gp join public.games g on g.id = gp.game_id
                   where gp.channel_id = c.id and g.removed_at is null and (v_since is null or g.ended_at >= v_since)
                   group by gp.name having count(*) >= greatest((o.config ->> 'min_games')::int, 1)) x
             order by respect desc, x.n desc, x.name
             limit (o.config ->> 'board_rows')::int) r) end,
    'draw', case when 'reveal' = any(v_on) then
      (select jsonb_build_object('id', d.id, 'kind', d.kind, 'n', d.n, 'result', d.result, 'created_at', d.created_at)
       from public.draws d where d.channel_id = c.id and d.undone_at is null order by d.created_at desc limit 1) end
  );
end $$;
revoke execute on function public.overlay_snapshot(text) from public, anon, authenticated;
grant execute on function public.overlay_snapshot(text) to service_role;

-- Undo brings back a deleted overlay. Everything else is as 0028.
create or replace function public.undo(p_channel uuid, p_activity bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b        record;
  a        public.activity;
  v_by     text;
  v_mod    uuid[];
  v_names  text[];
  v_rows   jsonb := '[]'::jsonb;
  v_then   bigint;
  v_games  uuid[];
  v_gnames text[];
begin
  -- Victory with a draw after it wrote two activities; the game's names the draw (then), which
  -- is undone first, in its own write, so the game's players are as the game left them.
  select (x.undo ->> 'then')::bigint into v_then from public.activity x
  where x.id = p_activity and x.channel_id = p_channel and x.undone_at is null;
  if v_then is not null and exists (select 1 from public.activity x
                                    where x.id = v_then and x.undone_at is null and x.undo is not null) then
    perform public.undo(p_channel, v_then, null);
  end if;

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
      games_played = r.games_played, sort_key = coalesce(r.sort_key, p.sort_key), team_slot = r.team_slot,
      changed_v = r.changed_v, changed_by = r.changed_by
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

  -- Games: a recorded game is removed; a removed or cleared one comes back; a forgotten
  -- person's rows and names come back. Records are recounted for every name involved.
  if a.undo ? 'game' then
    update public.games g set removed_at = now()
    where g.id = (a.undo ->> 'game')::uuid and g.channel_id = p_channel;
    v_games := array[(a.undo ->> 'game')::uuid];
  end if;
  if a.undo ? 'games' then
    select array_agg((e #>> '{}')::uuid) into v_games from jsonb_array_elements(a.undo -> 'games') e;
    update public.games g set removed_at = null where g.channel_id = p_channel and g.id = any(v_games);
  end if;
  if a.undo ? 'game_teams' then
    update public.games g set teams = r.teams
    from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb)
    where g.id = r.id and g.channel_id = p_channel;
    insert into public.game_players
    select r.* from jsonb_populate_recordset(null::public.game_players, a.undo -> 'game_players') r
    where r.channel_id = p_channel
    on conflict do nothing;
    select array_agg(r.id) into v_games from jsonb_to_recordset(a.undo -> 'game_teams') r (id uuid, teams jsonb);
  end if;
  if v_games is not null then
    select coalesce(array_agg(distinct gp.name), '{}') into v_gnames
    from public.game_players gp where gp.game_id = any(v_games);
    v_rows := v_rows || case when cardinality(v_games) > 20 then jsonb_build_array(jsonb_build_object('_t', 'games_reload'))
                             else coalesce((select jsonb_agg(private.game_json(g)) from public.games g
                                            where g.id = any(v_games)), '[]'::jsonb) end
      || private.recount(p_channel, v_gnames) || jsonb_build_array(private.score(p_channel));
  end if;

  -- Overlay (0031): a deleted overlay comes back, key and all.
  if a.undo ? 'overlay' then
    update public.overlays o set deleted_at = null where o.id = (a.undo ->> 'overlay')::uuid and o.channel_id = p_channel;
  end if;

  update public.activity x set undone_at = now() where x.id = a.id returning * into a;
  v_rows := v_rows || jsonb_build_array((to_jsonb(a) - 'undo') || '{"_t":"activity"}'::jsonb);
  return private.commit(p_channel, b.next_v, b.actor, 'undo', a.action,
    jsonb_build_object('activity', a.id), null, p_request_id, v_rows);
end $$;
