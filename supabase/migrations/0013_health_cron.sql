-- Subscription health (spec § Realtime → Health): pg_cron + pg_net call /api/cron/health every
-- 10 minutes, independent of Vercel's cron plan. The bearer is a Vault secret generated here; it
-- never leaves the database, because the route asks cron_secret_ok instead of holding a copy.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'queue_cron_secret',
  'Bearer that pg_cron sends to /api/cron/health');

create function public.cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets s
                 where s.name = 'queue_cron_secret' and s.decrypted_secret = p_secret)
$$;
revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

create function private.health_ping() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://theatlas-queue.vercel.app/api/cron/health',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'queue_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$;
revoke execute on function private.health_ping() from public, anon, authenticated;

select cron.schedule('queue-health', '*/10 * * * *', 'select private.health_ping()');
