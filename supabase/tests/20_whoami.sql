-- whoami(): the app's one call for "who is signed in". Runs after 10_rls.sql
-- in the same database, so its fixtures exist.
\set ON_ERROR_STOP 1

select test.claims('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select test.ok((select role = 'staff' and active and not mfa_enrolled from public.whoami()), 'whoami: staff profile, no MFA');
reset role;

select test.claims('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select test.ok((select not active from public.whoami()), 'whoami: deactivated user is reported inactive');
reset role;

select test.claims('00000000-0000-0000-0000-00000000000e', 'aal1');
set role authenticated;
select test.ok((select mfa_enrolled from public.whoami()), 'whoami: enrolled authenticator is reported even on aal1');
reset role;

select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', false);
set role authenticated;
select test.ok((select count(*) = 0 from public.whoami()), 'whoami: unknown user gets no row');
reset role;

set role anon;
do $$ begin
  begin perform public.whoami();
    raise exception 'FAIL: anon called whoami';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot call whoami'; end;
end $$;
reset role;

\echo 'whoami tests complete.'
