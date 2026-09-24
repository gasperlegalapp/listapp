-- One call that tells the app who is signed in: profile, active flag, and
-- whether they have an authenticator enrolled. Replaces a round trip to the
-- auth server on every page. The session's assurance level (aal1/aal2) comes
-- from the signed JWT itself; RLS already refuses aal1 sessions for anyone
-- with an enrolled factor, so this only decides where to send them.
create or replace function public.whoami()
returns table (id uuid, full_name text, email text, role text, active boolean, mfa_enrolled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email, p.role, p.active,
         exists (
           select 1 from auth.mfa_factors f
           where f.user_id = p.id and f.status = 'verified'
         )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke execute on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;
