-- Measured with 50,000 activity rows over 30 days: the cooldown lookup uses activity_created
-- (the last 10 seconds across all channels, 0.04 ms), never activity_recent. 0014 was read off
-- an empty-table plan; the index only cost writes.
drop index public.activity_recent;
