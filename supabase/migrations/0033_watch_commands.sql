-- Stage 15 (D33): /watch shows the channel's own chat commands. The 0029 snapshot moves to
-- private unchanged; public.watch_snapshot adds `commands` to an enabled page's payload (perk only
-- while the perk is on). Commands are what the streamer types in chat anyway: public by nature.
alter function public.watch_snapshot(text) set schema private;
alter function private.watch_snapshot(text) rename to watch_snapshot_base;
revoke execute on function private.watch_snapshot_base(text) from public, anon, authenticated, service_role;

create function public.watch_snapshot(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := private.watch_snapshot_base(p_slug);
  s public.settings;
begin
  if v is null or v ? 'disabled' then return v; end if;
  select x.* into s from public.settings x join public.channels c on c.id = x.channel_id where c.slug = lower(p_slug);
  return v || jsonb_build_object('commands', jsonb_strip_nulls(jsonb_build_object(
    'join', s.join_command, 'leave', s.leave_command, 'position', s.position_command, 'away', s.away_command,
    'perk', case when s.perk_enabled then s.perk_command end)));
end $$;
revoke execute on function public.watch_snapshot(text) from public, anon, authenticated;
grant execute on function public.watch_snapshot(text) to service_role;
