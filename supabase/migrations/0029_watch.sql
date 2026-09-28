-- Stage 11: the public /watch page. The streamer may share the Games section too (opt-in).
alter table public.settings drop constraint settings_watch_sections_check;
alter table public.settings add constraint settings_watch_sections_check
  check (watch_sections <@ array['teams', 'queue', 'games', 'moderation', 'riot_ids']);

-- A game's rosters in slot order (0028), as the team cards showed them at Victory.
create or replace function private.game_roster(p_channel uuid, p_team smallint) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username, 'riot_id', p.riot_id,
      'locked', p.locked,
      'rank', (select jsonb_build_object('tier', r.tier, 'division', r.division, 'lp', r.league_points)
               from public.riot_cache r where r.puuid = p.puuid))
    order by p.team_slot nulls last, p.sort_key, p.joined_at), '[]'::jsonb)
  from public.players p
  where p.channel_id = p_channel and p.deleted_at is null and p.status = 'playing' and p.team = p_team
$$;
revoke execute on function private.game_roster(uuid, smallint) from public, anon, authenticated;

-- What /watch/<slug> and /api/watch/<slug> show (spec § Security → Public payload), an explicit
-- whitelist: never Kick user ids, activity, reasons, who recorded or sanctioned, or any setting
-- beyond labels. Riot IDs and ranks only with `riot_ids`; moderation names and kind only with
-- `moderation`; games and the all-time wins board only with `games`. Null for an unknown slug
-- (a real 404); only the name and labels when the page is off.
create function public.watch_snapshot(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.channels;
  s public.settings;
  v_riot boolean;
begin
  select * into c from public.channels where slug = lower(p_slug);
  if not found then return null; end if;
  select * into s from public.settings where channel_id = c.id;
  if not coalesce(s.watch_enabled, false) then
    return jsonb_build_object('disabled', true, 'channel', jsonb_build_object('slug', c.slug, 'name', c.display_name),
      'labels', coalesce(s.labels, '{}'::jsonb));
  end if;
  v_riot := 'riot_ids' = any(s.watch_sections) and s.riot_enabled;

  return jsonb_build_object(
    'v', c.version,
    'channel', jsonb_build_object('slug', c.slug, 'name', c.display_name, 'live', c.live_since is not null),
    'labels', s.labels,
    'sections', to_jsonb(s.watch_sections),
    'team_size', s.team_size,
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kick_username', p.kick_username,
                  'status', p.status, 'team', p.team, 'team_slot', p.team_slot, 'sort_key', p.sort_key, 'locked', p.locked,
                  'riot_id', case when v_riot then p.riot_id end,
                  'rank', case when v_riot then private.player_json(p) -> 'rank' end)
                order by p.sort_key, p.joined_at), '[]'::jsonb)
                from public.players p
                where p.channel_id = c.id and p.deleted_at is null and p.status in ('waiting', 'playing')),
    'draw', (select jsonb_build_object('id', d.id, 'kind', d.kind, 'n', d.n, 'result', d.result, 'created_at', d.created_at)
             from public.draws d where d.channel_id = c.id and d.undone_at is null order by d.created_at desc limit 1),
    'score', private.score(c.id) - '_t',
    'games', case when 'games' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('n', g.n, 'winner', g.winner, 'ended_at', g.ended_at,
         'teams', (select jsonb_agg((select coalesce(jsonb_agg(case when e ? 'removed' then e
                                                                    else jsonb_build_object('kick_username', e ->> 'kick_username', 'locked', e -> 'locked',
                                                                           'riot_id', case when v_riot then e -> 'riot_id' end,
                                                                           'rank', case when v_riot then e -> 'rank' end) end), '[]'::jsonb)
                                     from jsonb_array_elements(t) e) order by i)
                   from jsonb_array_elements(g.teams) with ordinality x(t, i)))
         order by g.n desc), '[]'::jsonb)
       from (select * from public.games x where x.channel_id = c.id and x.removed_at is null order by x.n desc limit 10) g) end,
    -- All time (owner, 2026-09-28): top 10 by wins. game_players keeps lower-cased names, so the
    -- casing comes from the queue, else the latest game that names them.
    'board', case when 'games' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(
           (select p.kick_username from public.players p where p.channel_id = c.id and lower(p.kick_username) = r.name limit 1),
           (select e ->> 'kick_username' from public.games g, jsonb_array_elements(g.teams -> 0 || g.teams -> 1) e
            where g.channel_id = c.id and lower(e ->> 'kick_username') = r.name order by g.n desc limit 1),
           r.name), 'wins', r.wins, 'losses', r.losses) order by r.wins desc, r.losses, r.name), '[]'::jsonb)
       from (select * from public.player_records x where x.channel_id = c.id and x.wins > 0
             order by x.wins desc, x.losses, x.name limit 10) r) end,
    -- Names and kind only, never reasons, never who (spec § Security).
    'moderation', case when 'moderation' = any(s.watch_sections) then
      (select coalesce(jsonb_agg(jsonb_build_object('kick_username', m.kick_username, 'kind', m.kind) order by m.created_at desc), '[]'::jsonb)
       from public.moderation m
       where m.channel_id = c.id and m.revoked_at is null and (m.expires_at is null or m.expires_at > now())
         and (m.games_left is null or m.games_left > 0)) end
  );
end $$;
revoke execute on function public.watch_snapshot(text) from public, anon, authenticated;
grant execute on function public.watch_snapshot(text) to service_role;

-- The sitemap (DESIGN.md § Indexing): every enabled /watch, with when it last changed.
create function public.watch_sitemap() returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.slug, greatest(s.updated_at, (select max(g.ended_at) from public.games g where g.channel_id = c.id))
  from public.channels c join public.settings s on s.channel_id = c.id
  where s.watch_enabled
$$;
revoke execute on function public.watch_sitemap() from public, anon, authenticated;
grant execute on function public.watch_sitemap() to service_role;
