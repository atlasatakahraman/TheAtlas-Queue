-- Retention (spec § Data model). One pg_cron job every 5 minutes runs every rule; cleanup sends
-- no realtime events (clients never showed what it removes).
create function private.retention() returns void
language sql set search_path = '' as $$
  -- Soft-deleted players: the Undo toast is long gone after 10 minutes, and so is the inverse
  -- that could bring them back.
  delete from public.players where deleted_at < now() - interval '10 minutes';
  update public.activity set undo = null where undo is not null and created_at < now() - interval '10 minutes';
  -- Draws older than a day, except each channel's standing one (/watch and /overlay show it).
  delete from public.draws d
  where d.created_at < now() - interval '24 hours'
    and d.id is distinct from (select x.id from public.draws x
                               where x.channel_id = d.channel_id and x.undone_at is null
                               order by x.created_at desc limit 1);
  delete from public.activity where created_at < now() - interval '30 days';
  delete from public.webhook_events where received_at < now() - interval '1 hour';
  -- Perk uses outlive their rolling window by a day.
  delete from public.perk_uses u using public.settings s
  where s.channel_id = u.channel_id and u.used_at < now() - make_interval(days => s.perk_window_days + 1);
  -- Badge-granted moderators unseen for 30 days; manual ones stay until the owner removes them.
  delete from public.channel_members
  where source = 'badge' and coalesce(last_seen_at, created_at) < now() - interval '30 days';
  delete from public.riot_cache where fetched_at < now() - interval '7 days';
$$;
revoke execute on function private.retention() from public, anon, authenticated;

select cron.schedule('queue-retention', '*/5 * * * *', 'select private.retention()');
