-- 0053: a player added by hand is linked to the chatter with that Kick name.
--
-- A row added from the dashboard has no kick_user_id, and refresh_badges matched on kick_user_id
-- only, so its badges stayed empty and private.perk_eligible never protected it in a pick, even
-- while !perk (which reads the message's own badges) said the chatter had uses left.
--
-- Now the chatter's first message (or any command) also claims a live, unlinked row on that
-- channel whose name matches theirs, case-insensitively: Kick names are unique, so the sender is
-- that person. It is skipped when another live row already carries the sender's id (a Kick rename),
-- which players_one_user would refuse anyway. p_username defaults to null so the old 3-argument
-- call keeps working until the webhook that sends it is deployed.

drop function public.refresh_badges(bigint, bigint, text[]);

create function public.refresh_badges(p_broadcaster bigint, p_sender_id bigint, p_badges text[],
                                      p_username text default null) returns void
language sql security definer set search_path = '' as $$
  update public.players p set badges = coalesce(p_badges, '{}'), kick_user_id = p_sender_id
  from public.channels c
  where c.kick_channel_id = p_broadcaster and p.channel_id = c.id and p.deleted_at is null
    and cardinality(coalesce(p_badges, '{}')) <= 16
    and (
      (p.kick_user_id = p_sender_id and p.badges is distinct from coalesce(p_badges, '{}'))
      or (p.kick_user_id is null and p_sender_id is not null and p_username ~ '^\S{1,40}$'
          and lower(p.kick_username) = lower(p_username)
          and not exists (select 1 from public.players q
                          where q.channel_id = c.id and q.kick_user_id = p_sender_id and q.deleted_at is null))
    )
$$;
revoke execute on function public.refresh_badges(bigint, bigint, text[], text) from public, anon, authenticated;
grant execute on function public.refresh_badges(bigint, bigint, text[], text) to service_role;
