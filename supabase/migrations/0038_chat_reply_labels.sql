-- Every chat reply is a label the streamer can reword (owner, 2026-09-29): the curated set gains
-- chat.joined.many, chat.watch and chat.rules (editable in Settings since 0034/0036, but refused
-- here, so saving any of them failed with settings.label_invalid), chat.rejected.offline,
-- chat.rejected.closed and chat.commands. Only widens the check; no row changes.
-- DESIGN.md § Language and labels.

create or replace function private.labels_valid(l jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare loc text; v jsonb; k text; s jsonb;
begin
  if jsonb_typeof(l) <> 'object' then return false; end if;
  for loc, v in select * from jsonb_each(l) loop
    if loc not in ('en', 'tr') or jsonb_typeof(v) <> 'object' then return false; end if;
    for k, s in select * from jsonb_each(v) loop
      if k <> all (array[
        'brand.subtitle', 'team.1', 'team.2', 'match.vs',
        'queue.title', 'queue.hint', 'queue.empty.title', 'queue.empty.hint',
        'action.add', 'action.draw', 'action.reroll', 'action.pick',
        'watch.title', 'watch.subtitle', 'watch.disabled',
        'overlay.queue.title', 'overlay.draw.title',
        'chat.joined', 'chat.joined.many', 'chat.rejected.banned', 'chat.rejected.duplicate',
        'chat.rejected.offline', 'chat.rejected.closed', 'chat.position', 'chat.perk',
        'chat.commands', 'chat.watch', 'chat.rules'
      ]) then return false; end if;
      if jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') > 80 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
