-- RLS probe. Run with execute_sql. Raises on the first failure; ends with NOTICE 'rls ok'.
-- Extend it in every stage that adds a table or an RPC.
do $$
declare
  owner_p   uuid := gen_random_uuid();
  other_p   uuid := gen_random_uuid();
  blocked_p uuid := gen_random_uuid();
  mod_p     uuid := gen_random_uuid();
  t         text;
  ch        uuid := gen_random_uuid();
  n         int;
begin
  insert into public.profiles (id, kick_user_id, username) values
    (owner_p, -1, 'probe_owner'), (other_p, -2, 'probe_other'), (blocked_p, -3, 'probe_blocked'), (mod_p, -4, 'probe_mod');
  insert into public.channels (id, kick_channel_id, slug, display_name) values (ch, -1, 'probe-channel', 'probe');
  insert into public.channel_members (channel_id, kick_user_id, role, source, blocked) values
    (ch, -1, 'owner', 'owner', false), (ch, -3, 'mod', 'manual', true), (ch, -4, 'mod', 'manual', false);
  insert into public.settings (channel_id) values (ch);

  -- Owner: sees channel, settings, all three member rows, own profile only.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.channels where id = ch;         if n <> 1 then raise exception 'owner: channel %', n; end if;
  select count(*) into n from public.settings where channel_id = ch; if n <> 1 then raise exception 'owner: settings %', n; end if;
  select count(*) into n from public.channel_members where channel_id = ch; if n <> 3 then raise exception 'owner: members %', n; end if;
  select count(*) into n from public.profiles;                        if n <> 1 then raise exception 'owner: profiles %', n; end if;
  reset role;

  -- Member of nothing: sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', other_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.channels where id = ch;         if n <> 0 then raise exception 'other: channel %', n; end if;
  select count(*) into n from public.settings where channel_id = ch; if n <> 0 then raise exception 'other: settings %', n; end if;
  reset role;

  -- Blocked mod: sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', blocked_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.channels where id = ch;         if n <> 0 then raise exception 'blocked: channel %', n; end if;
  reset role;

  -- Member RPCs: a non-member and a blocked mod are refused by the role check.
  foreach t in array array[other_p::text, blocked_p::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.add_player(ch, 'probe_player', null, gen_random_uuid());
      raise exception 'add_player allowed for %', t using errcode = 'XX000';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'auth.not_member' then raise exception 'add_player for %: %', t, sqlerrm using errcode = 'XX000'; end if;
    end;
    reset role;
  end loop;

  -- Owner RPCs: a moderator is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', mod_p, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.update_settings(ch, '{"team_size":2}', gen_random_uuid());
    raise exception 'mod: update_settings allowed' using errcode = 'XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'auth.role' then raise exception 'mod: update_settings %', sqlerrm using errcode = 'XX000'; end if;
  end;
  reset role;

  -- No client writes any Stage 2 table directly, and anon reads none of them.
  foreach t in array array['players', 'draws', 'perk_uses', 'moderation', 'activity', 'webhook_events', 'riot_cache', 'kick_tokens'] loop
    begin
      set local role authenticated;
      execute format('delete from public.%I', t);
      raise exception 'authenticated can delete from %', t using errcode = 'XX000';
    exception when insufficient_privilege then null;
    end;
    reset role;
    begin
      set local role anon;
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'anon can read %', t using errcode = 'XX000';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  begin
    set local role anon;
    perform public.get_state(ch);
    raise exception 'anon: get_state callable' using errcode = 'XX000';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Authenticated cannot write.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_p, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    update public.settings set team_size = 2 where channel_id = ch;
    raise exception 'owner: direct update allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Anon: no table access, no private helpers.
  begin
    set local role anon;
    perform 1 from public.channels;
    raise exception 'anon: channels readable';
  exception when insufficient_privilege then null;
  end;
  reset role;
  begin
    set local role anon;
    perform private.member_role(ch);
    raise exception 'anon: member_role callable';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Server RPCs (Stage 3): only the secret key (service_role) may call them.
  if exists (select 1 from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname in ('webhook_context', 'ingest_chat', 'sync_member_badge', 'set_live', 'set_riot_rank',
                                 'onboard_channel', 'set_subscription_state', 'cron_secret_ok')
               and (has_function_privilege('anon', p.oid, 'execute')
                    or has_function_privilege('authenticated', p.oid, 'execute')
                    or not has_function_privilege('service_role', p.oid, 'execute'))) then
    raise exception 'a server RPC is callable by a client role, or not by service_role';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('webhook_context', 'ingest_chat', 'sync_member_badge', 'set_live', 'set_riot_rank',
                        'onboard_channel', 'set_subscription_state', 'cron_secret_ok')) <> 8 then
    raise exception 'server RPC list out of date';
  end if;
  begin
    set local role authenticated;
    perform public.ingest_chat(-9, 'probe', 'join', null, -9, 'probe', '{}');
    raise exception 'authenticated: ingest_chat callable' using errcode = 'XX000';
  exception when insufficient_privilege then null;
  end;
  reset role;

  delete from public.channels where id = ch;
  delete from public.profiles where id in (owner_p, other_p, blocked_p, mod_p);
  raise notice 'rls ok';
end $$;
