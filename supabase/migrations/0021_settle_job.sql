-- Each minute, settle what time and draws ended (0020). Its first run also brings any queue in
-- line with sanctions set before 0020, so it waits for the owner's yes (2026-09-27).
select cron.schedule('queue-settle', '* * * * *', 'select private.settle_all()');
