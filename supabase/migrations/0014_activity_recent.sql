-- ingest_chat's join cooldown reads one channel's last 10 seconds of activity. Without this it
-- walks activity_by_channel and filters on created_at: up to 30 days of feed per join.
create index activity_recent on public.activity (channel_id, created_at);
