-- Row-level security and grants.
--
-- Model:
--   admin     everything, including templates and users
--   attorney  all matters and lists; can soft-delete, restore and revert
--   staff     all matters and lists; can create and edit; cannot delete
--
-- private.app_role() is null for anyone signed out, deactivated, or holding
-- an aal1 session while an authenticator is enrolled. Every policy requires a
-- non-null role, so those callers get zero rows, not an error page.
--
-- (select private.app_role()) is wrapped in a subquery so Postgres evaluates
-- it once per statement instead of once per row.
--
-- There are no DELETE policies anywhere: nothing is hard-deleted by the app.

-- ---------------------------------------------------------------------------
-- Baseline grants. Supabase grants ALL to anon/authenticated by default; we
-- take it back and grant only what the policies below can use. The app never
-- queries data as anon.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon;

grant select, update (full_name, role, active) on public.profiles to authenticated;
grant select, insert on public.templates to authenticated;
grant select, insert, update on public.cases to authenticated;
grant select, insert, update on public.instances to authenticated;
grant select on public.revisions to authenticated;
grant select, insert, update (deleted_at) on public.attachments to authenticated;
grant select on public.delete_log to authenticated;
-- login_attempts: no grants to anon/authenticated at all.

grant execute on function public.set_instance_field(uuid, text, jsonb) to authenticated;
grant execute on function public.revert_field(bigint) to authenticated;
grant execute on function private.app_role() to authenticated;
grant execute on function private.is_app_user(text) to authenticated;
grant execute on function private.check_soft_delete(timestamptz, timestamptz) to authenticated;
grant execute on function private.valid_option(text, integer) to authenticated;
grant execute on function private.app_role() to service_role;
grant execute on function private.is_app_user(text) to service_role;
grant execute on function private.check_soft_delete(timestamptz, timestamptz) to service_role;
grant execute on function private.valid_option(text, integer) to service_role;
grant execute on function public.login_lockout_seconds(text, text, text) to service_role;

-- Append-only, even for the secret key.
revoke update, delete, truncate on public.revisions from service_role;
revoke update, delete, truncate on public.delete_log from service_role;

alter table public.profiles enable row level security;
alter table public.templates enable row level security;
alter table public.cases enable row level security;
alter table public.instances enable row level security;
alter table public.revisions enable row level security;
alter table public.attachments enable row level security;
alter table public.delete_log enable row level security;
alter table public.login_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Members see everyone (history shows names). Anyone signed in sees their own
-- row, so the app can tell a deactivated user why they are locked out.
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select private.app_role()) is not null or id = (select auth.uid()));

-- Own row (name only; profiles_guard blocks role/active) or admin.
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select private.app_role()) = 'admin' or (id = (select auth.uid()) and (select private.app_role()) is not null))
  with check ((select private.app_role()) = 'admin' or (id = (select auth.uid()) and (select private.app_role()) is not null));

-- ---------------------------------------------------------------------------
-- templates
-- ---------------------------------------------------------------------------
create policy templates_select on public.templates
  for select to authenticated
  using ((select private.app_role()) is not null);

create policy templates_insert on public.templates
  for insert to authenticated
  with check ((select private.app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create policy cases_select on public.cases
  for select to authenticated
  using (
    (select private.app_role()) is not null
    and (deleted_at is null or (select private.app_role()) in ('admin', 'attorney'))
  );

create policy cases_insert on public.cases
  for insert to authenticated
  with check ((select private.app_role()) is not null and deleted_at is null);

create policy cases_update on public.cases
  for update to authenticated
  using (
    (select private.app_role()) is not null
    and (deleted_at is null or (select private.app_role()) in ('admin', 'attorney'))
  )
  with check ((select private.app_role()) is not null);

-- ---------------------------------------------------------------------------
-- instances
-- ---------------------------------------------------------------------------
create policy instances_select on public.instances
  for select to authenticated
  using (
    (select private.app_role()) is not null
    and (deleted_at is null or (select private.app_role()) in ('admin', 'attorney'))
  );

create policy instances_insert on public.instances
  for insert to authenticated
  with check (
    (select private.app_role()) is not null
    and deleted_at is null
    and exists (select 1 from public.cases c where c.id = case_id and c.deleted_at is null)
  );

create policy instances_update on public.instances
  for update to authenticated
  using (
    (select private.app_role()) is not null
    and (deleted_at is null or (select private.app_role()) in ('admin', 'attorney'))
  )
  with check ((select private.app_role()) is not null);

-- ---------------------------------------------------------------------------
-- revisions: readable wherever the list is readable. Written only by trigger.
-- ---------------------------------------------------------------------------
create policy revisions_select on public.revisions
  for select to authenticated
  using (
    (select private.app_role()) is not null
    and exists (select 1 from public.instances i where i.id = instance_id)
  );

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create policy attachments_select on public.attachments
  for select to authenticated
  using (
    (select private.app_role()) is not null
    and (deleted_at is null or (select private.app_role()) in ('admin', 'attorney'))
    and exists (select 1 from public.instances i where i.id = instance_id)
  );

create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    (select private.app_role()) is not null
    and exists (select 1 from public.instances i where i.id = instance_id and i.deleted_at is null)
  );

create policy attachments_update on public.attachments
  for update to authenticated
  using ((select private.app_role()) in ('admin', 'attorney'))
  with check ((select private.app_role()) in ('admin', 'attorney'));

-- ---------------------------------------------------------------------------
-- delete_log: attorneys and admins can read it. Written only by trigger.
-- ---------------------------------------------------------------------------
create policy delete_log_select on public.delete_log
  for select to authenticated
  using ((select private.app_role()) in ('admin', 'attorney'));

-- login_attempts: RLS on, no policies. Only the secret key (bypassrls) reads it.
