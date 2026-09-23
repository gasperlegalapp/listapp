-- Helper functions, guard triggers, audit triggers, and RPCs.
--
-- Guard triggers are SECURITY INVOKER so current_user is the caller's role
-- ('authenticated' for app users). They only restrict app users; migrations,
-- the SQL editor (postgres) and the server's secret key (service_role) pass.
-- Audit triggers are SECURITY DEFINER so they can write to tables that app
-- users have no insert rights on.

-- ---------------------------------------------------------------------------
-- Who is calling?
-- Returns the caller's role, or null if they are not signed in, deactivated,
-- or have an enrolled authenticator but signed in without it (aal1). Every RLS
-- policy goes through this, so deactivation and MFA are enforced in Postgres.
-- ---------------------------------------------------------------------------
create or replace function private.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and (
      coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      )
    )
$$;

create or replace function private.is_app_user(current_user_name text)
returns boolean
language sql
immutable
as $$ select current_user_name in ('authenticated', 'anon') $$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile. Role always starts as staff; an admin promotes.
-- Public signup is off, so auth.users rows only come from admin invites.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(lower(new.email), ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(lower(new.email), '') where id = new.id;
  return new;
end
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- profiles guard: users may edit their own name; only admins change role or
-- active, and never their own (so the last admin cannot lock everyone out).
-- ---------------------------------------------------------------------------
create or replace function private.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_app_user(current_user) then
    if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
      raise exception 'id, email and created_at cannot be changed' using errcode = '42501';
    end if;
    if new.role <> old.role or new.active <> old.active then
      if coalesce(private.app_role(), '') <> 'admin' then
        raise exception 'only an admin can change a role or deactivate a user' using errcode = '42501';
      end if;
      if new.id = auth.uid() then
        raise exception 'admins cannot change their own role or deactivate themselves' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function private.profiles_guard();

-- ---------------------------------------------------------------------------
-- templates: immutable. Publishing a revision inserts version = max + 1.
-- ---------------------------------------------------------------------------
create or replace function private.templates_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
begin
  select coalesce(max(version), 0) + 1 into v_next from public.templates where code = new.code;
  if new.version <> v_next then
    raise exception 'next version of % must be %', new.code, v_next using errcode = '23514';
  end if;
  if new.schema ->> 'code' is distinct from new.code then
    raise exception 'schema.code does not match code' using errcode = '23514';
  end if;
  if private.is_app_user(current_user) then
    new.created_by := auth.uid();
  end if;
  return new;
end
$$;

create trigger templates_before_insert
  before insert on public.templates
  for each row execute function private.templates_before_insert();

create or replace function private.templates_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'templates are immutable; publish a new version instead' using errcode = '42501';
end
$$;

create trigger templates_immutable
  before update or delete on public.templates
  for each row execute function private.templates_immutable();

-- ---------------------------------------------------------------------------
-- Shared: soft-delete permission check and bookkeeping.
-- ---------------------------------------------------------------------------
create or replace function private.check_soft_delete(old_deleted_at timestamptz, new_deleted_at timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if old_deleted_at is distinct from new_deleted_at
     and private.is_app_user(current_user)
     and coalesce(private.app_role(), '') not in ('admin', 'attorney') then
    raise exception 'only attorneys and admins can delete or restore' using errcode = '42501';
  end if;
end
$$;

create or replace function private.log_delete(p_entity text, p_id uuid, p_old timestamptz, p_new timestamptz, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_old is distinct from p_new then
    insert into public.delete_log (entity, entity_id, action, label, actor)
    values (p_entity, p_id, case when p_new is null then 'restore' else 'delete' end, p_label, auth.uid());
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create or replace function private.cases_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if private.is_app_user(current_user) then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    new.updated_at := now();
    new.updated_by := new.created_by;
    return new;
  end if;

  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'id, created_by and created_at cannot be changed' using errcode = '42501';
  end if;
  perform private.check_soft_delete(old.deleted_at, new.deleted_at);
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (select 1 from public.instances i where i.case_id = new.id and i.deleted_at is null) then
      raise exception 'delete this matter''s checklists first' using errcode = '23503';
    end if;
    new.deleted_at := now();
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  elsif new.deleted_at is null then
    new.deleted_by := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

create trigger cases_before_write
  before insert or update on public.cases
  for each row execute function private.cases_before_write();

create or replace function private.cases_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_delete('case', new.id, old.deleted_at, new.deleted_at, new.name);
  return null;
end
$$;

create trigger cases_after_update
  after update on public.cases
  for each row execute function private.cases_after_update();

-- ---------------------------------------------------------------------------
-- instances
-- ---------------------------------------------------------------------------
create or replace function private.instances_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_latest integer;
begin
  if tg_op = 'INSERT' then
    -- New lists always use the newest published version of the checklist.
    select max(t2.version) into v_latest
    from public.templates t
    join public.templates t2 on t2.code = t.code
    where t.id = new.template_id;
    if new.template_version is distinct from v_latest then
      raise exception 'new lists must use the latest template version (%)', v_latest using errcode = '23514';
    end if;
    if private.is_app_user(current_user) then
      new.created_by := auth.uid();
      new.created_at := now();
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    new.updated_at := now();
    new.updated_by := new.created_by;
    return new;
  end if;

  if new.id <> old.id or new.case_id <> old.case_id or new.template_id <> old.template_id
     or new.template_version <> old.template_version
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'id, case, template, version and creator cannot be changed' using errcode = '42501';
  end if;
  perform private.check_soft_delete(old.deleted_at, new.deleted_at);

  if old.deleted_at is not null and new.deleted_at is not null
     and (new.data is distinct from old.data or new.label is distinct from old.label or new.status is distinct from old.status) then
    raise exception 'this list has been deleted' using errcode = '42501';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  elsif new.deleted_at is null and old.deleted_at is not null then
    if exists (select 1 from public.cases c where c.id = new.case_id and c.deleted_at is not null) then
      raise exception 'restore the matter first' using errcode = '23503';
    end if;
    new.deleted_by := null;
  end if;

  if new.data is distinct from old.data or new.label is distinct from old.label or new.status is distinct from old.status then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end
$$;

create trigger instances_before_write
  before insert or update on public.instances
  for each row execute function private.instances_before_write();

-- Every field change becomes a revisions row: key, old, new, who, when.
create or replace function private.instances_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.revisions (instance_id, field_key, old_value, new_value, changed_by)
    select new.id, e.key, null, e.value, auth.uid()
    from jsonb_each(new.data) e;
    return null;
  end if;

  if new.data is distinct from old.data then
    insert into public.revisions (instance_id, field_key, old_value, new_value, changed_by)
    select new.id, k.key, old.data -> k.key, new.data -> k.key, auth.uid()
    from (select jsonb_object_keys(old.data) as key union select jsonb_object_keys(new.data)) k
    where (old.data -> k.key) is distinct from (new.data -> k.key);
  end if;
  if new.label is distinct from old.label then
    insert into public.revisions (instance_id, field_key, old_value, new_value, changed_by)
    values (new.id, '_label', to_jsonb(old.label), to_jsonb(new.label), auth.uid());
  end if;
  perform private.log_delete('instance', new.id, old.deleted_at, new.deleted_at, new.label);
  return null;
end
$$;

create trigger instances_after_write
  after insert or update on public.instances
  for each row execute function private.instances_after_write();

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create or replace function private.attachments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if private.is_app_user(current_user) then
      new.uploaded_by := auth.uid();
      new.uploaded_at := now();
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    if split_part(new.storage_path, '/', 1) <> new.instance_id::text then
      raise exception 'storage_path must start with the instance id' using errcode = '23514';
    end if;
    return new;
  end if;

  if (new.id, new.instance_id, new.storage_path, new.file_name, new.mime_type, new.size_bytes, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.id, old.instance_id, old.storage_path, old.file_name, old.mime_type, old.size_bytes, old.uploaded_by, old.uploaded_at) then
    raise exception 'attachments cannot be edited, only deleted' using errcode = '42501';
  end if;
  perform private.check_soft_delete(old.deleted_at, new.deleted_at);
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  elsif new.deleted_at is null then
    new.deleted_by := null;
  end if;
  return new;
end
$$;

create trigger attachments_before_write
  before insert or update on public.attachments
  for each row execute function private.attachments_before_write();

create or replace function private.attachments_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_delete('attachment', new.id, old.deleted_at, new.deleted_at, new.file_name);
  return null;
end
$$;

create trigger attachments_after_update
  after update on public.attachments
  for each row execute function private.attachments_after_update();

-- ---------------------------------------------------------------------------
-- Append-only tables. Blocks UPDATE/DELETE even for the secret key.
-- ---------------------------------------------------------------------------
create or replace function private.append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end
$$;

create trigger revisions_append_only
  before update or delete on public.revisions
  for each row execute function private.append_only();

create trigger delete_log_append_only
  before update or delete on public.delete_log
  for each row execute function private.append_only();

-- ---------------------------------------------------------------------------
-- RPC: save one field. Field-level, so two people editing different fields of
-- the same list never overwrite each other. Validates the key against the
-- instance's template version and the value's shape. Runs as the caller, so
-- RLS decides whether they may write.
-- ---------------------------------------------------------------------------
create or replace function public.set_instance_field(p_instance_id uuid, p_key text, p_value jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spec jsonb;
  v_n integer;
  v_updated timestamptz;
  v_ok boolean;
begin
  if p_key is null or p_key !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid field key' using errcode = '22023';
  end if;

  select t.schema -> 'keys' -> p_key into v_spec
  from public.instances i
  join public.templates t on t.id = i.template_id
  where i.id = p_instance_id and i.deleted_at is null;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  if v_spec is null then
    raise exception 'unknown field %', p_key using errcode = '22023';
  end if;

  if p_value is null or p_value = 'null'::jsonb or p_value = '""'::jsonb or p_value = '[]'::jsonb then
    p_value := null;
  else
    v_n := (v_spec ->> 'n')::integer;
    v_ok := case v_spec ->> 't'
      when 'text' then jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= 20000
      when 'one' then jsonb_typeof(p_value) = 'string' and private.valid_option(p_value #>> '{}', v_n)
      when 'many' then jsonb_typeof(p_value) = 'array'
        and jsonb_array_length(p_value) <= v_n
        and not exists (
          select 1 from jsonb_array_elements(p_value) e
          where jsonb_typeof(e) <> 'string' or not private.valid_option(e #>> '{}', v_n)
        )
      else false
    end;
    if not v_ok then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
  end if;

  update public.instances
     set data = case when p_value is null then data - p_key
                     else jsonb_set(data, array[p_key], p_value, true) end
   where id = p_instance_id and deleted_at is null
  returning updated_at into v_updated;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  return v_updated;
end
$$;

create or replace function private.valid_option(p_opt text, p_n integer)
returns boolean
language sql
immutable
as $$
  select p_opt ~ '^opt[1-9][0-9]{0,2}$' and substr(p_opt, 4)::integer <= p_n
$$;

-- ---------------------------------------------------------------------------
-- RPC: revert one field to the value it had before a given revision.
-- Attorneys and admins only. Logged as a new revision, never a rewrite.
-- ---------------------------------------------------------------------------
create or replace function public.revert_field(p_revision_id bigint)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rev public.revisions%rowtype;
  v_updated timestamptz;
begin
  if coalesce(private.app_role(), '') not in ('admin', 'attorney') then
    raise exception 'only attorneys and admins can revert' using errcode = '42501';
  end if;
  select * into v_rev from public.revisions where id = p_revision_id;
  if not found then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  if v_rev.field_key = '_label' then
    update public.instances set label = v_rev.old_value #>> '{}'
     where id = v_rev.instance_id and deleted_at is null
    returning updated_at into v_updated;
    if not found then
      raise exception 'list not found' using errcode = 'P0002';
    end if;
    return v_updated;
  end if;
  return public.set_instance_field(v_rev.instance_id, v_rev.field_key, v_rev.old_value);
end
$$;

-- ---------------------------------------------------------------------------
-- Login lockout (server-only). Returns seconds until the caller may try again,
-- 0 if allowed. 5 failures for one email, or 20 from one IP, within 15
-- minutes locks for 15 minutes from the last failure. A success resets the
-- email counter.
-- ---------------------------------------------------------------------------
create or replace function public.login_lockout_seconds(p_email text, p_ip text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with last_ok as (
    select max(at) as at from public.login_attempts
    where email = lower(p_email) and succeeded
  ),
  email_fail as (
    select count(*) as n, max(at) as last_at from public.login_attempts
    where email = lower(p_email) and not succeeded
      and at > now() - interval '15 minutes'
      and at > coalesce((select at from last_ok), '-infinity'::timestamptz)
  ),
  ip_fail as (
    select count(*) as n, max(at) as last_at from public.login_attempts
    where p_ip is not null and ip = p_ip and not succeeded
      and at > now() - interval '15 minutes'
  )
  select greatest(
    0,
    case when e.n >= 5 then ceil(extract(epoch from (e.last_at + interval '15 minutes' - now())))::integer else 0 end,
    case when i.n >= 20 then ceil(extract(epoch from (i.last_at + interval '15 minutes' - now())))::integer else 0 end
  )
  from email_fail e, ip_fail i
$$;
