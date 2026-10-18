-- Local stack only (`supabase db reset` runs this after the migrations; production never does).
-- 0013 schedules `queue-health`, which POSTs to the production /api/cron/health every 10 minutes.
-- A local stack must never call production, so the job is removed here.
select cron.unschedule('queue-health');
