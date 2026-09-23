-- RLS probe. Run with execute_sql. Raises on the first failure; ends with NOTICE 'rls ok'.
-- Extend it in every stage that adds a table or an RPC.
do $$
declare
  owner_p   uuid := gen_random_uuid();
  other_p   uuid := gen_random_uuid();
  blocked_p uuid := gen_random_uuid();
  ch        uuid := gen_random_uuid();
  n         int;
begin
  insert into public.profiles (id, kick_user_id, username) values
    (owner_p, -1, 'probe_owner'), (other_p, -2, 'probe_other'), (blocked_p, -3, 'probe_blocked');
  insert into public.channels (id, kick_channel_id, slug, display_name) values (ch, -1, 'probe-channel', 'probe');
  insert into public.channel_members (channel_id, kick_user_id, role, source, blocked) values
    (ch, -1, 'owner', 'owner', false), (ch, -3, 'mod', 'manual', true);
  insert into public.settings (channel_id) values (ch);

  -- Owner: sees channel, settings, both member rows, own profile only.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.channels where id = ch;         if n <> 1 then raise exception 'owner: channel %', n; end if;
  select count(*) into n from public.settings where channel_id = ch; if n <> 1 then raise exception 'owner: settings %', n; end if;
  select count(*) into n from public.channel_members where channel_id = ch; if n <> 2 then raise exception 'owner: members %', n; end if;
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

  delete from public.channels where id = ch;
  delete from public.profiles where id in (owner_p, other_p, blocked_p);
  raise notice 'rls ok';
end $$;
