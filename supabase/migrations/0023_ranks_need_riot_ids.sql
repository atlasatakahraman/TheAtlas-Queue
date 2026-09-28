-- Riot IDs are the master switch (owner, 2026-09-28): require_riot_id shows and asks for Riot
-- IDs, and ranks (riot_enabled) are looked up only while it is on. riot_enabled keeps its own
-- value, so turning Riot IDs back on brings ranks back as they were. Chat joins look ranks up
-- only when the webhook is handed a region.
create or replace function public.webhook_context(p_broadcaster bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'channel_id', c.id,
    'commands', jsonb_build_object('join', s.join_command, 'leave', s.leave_command,
      'position', s.position_command, 'perk', s.perk_command, 'away', s.away_command),
    'riot', case when s.riot_enabled and s.require_riot_id then s.riot_region end,
    'members', coalesce((select jsonb_object_agg(m.kick_user_id::text,
        jsonb_build_object('source', m.source, 'blocked', m.blocked, 'seen', m.last_seen_at))
      from public.channel_members m where m.channel_id = c.id), '{}'::jsonb))
  from public.channels c join public.settings s on s.channel_id = c.id
  where c.kick_channel_id = p_broadcaster
$$;
