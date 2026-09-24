-- List App schema.
-- Every table has row-level security enabled (see 20260923000300_rls.sql).
-- Nothing is hard-deleted by the app: cases, instances and attachments are
-- soft-deleted, and revisions and the delete log are append-only.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles: one per auth user. Created by trigger when an admin invites.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  full_name   text not null default '',
  email       text not null default '',
  role        text not null default 'staff' check (role in ('admin', 'attorney', 'staff')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is
  'Leavers are deactivated (active = false), never deleted, so their revision history survives.';

-- ---------------------------------------------------------------------------
-- templates: immutable, versioned checklist definitions. A revision is a new
-- row with version + 1. Rows are never updated or deleted (trigger-enforced).
-- ---------------------------------------------------------------------------
create table public.templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^GL-A[0-9]+$'),
  name        text not null,
  version     integer not null check (version >= 1),
  schema      jsonb not null check (jsonb_typeof(schema) = 'object' and jsonb_typeof(schema -> 'keys') = 'object'),
  accent      text not null check (accent in ('ok', 'slate', 'gold', 'stamp', 'teal', 'plum')),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (code, version),
  unique (id, version)
);

-- ---------------------------------------------------------------------------
-- cases (matters)
-- ---------------------------------------------------------------------------
create table public.cases (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) > 0),
  case_number       text,
  county            text,
  court             text,
  matter_type       text not null check (matter_type in ('guardianship', 'estate', 'trust', 'other')),
  our_role          text check (our_role in ('guardian_of_estate', 'fiduciary_administrator', 'counsel', 'trustee')),
  ward_or_decedent  text,
  valuation_date    date,
  status            text not null default 'open' check (status in ('open', 'closed')),
  created_by        uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id),
  updated_at        timestamptz not null default now(),
  deleted_by        uuid references public.profiles (id),
  deleted_at        timestamptz,
  check ((deleted_at is null) = (deleted_by is null))
);
comment on column public.cases.valuation_date is 'Date of death or appointment: the inventory valuation date.';

-- ---------------------------------------------------------------------------
-- instances: one filled-out checklist for one asset. The random UUID is the
-- pasteable URL (/l/<id>). template_version is stamped at creation and the
-- composite FK keeps it consistent with template_id.
-- ---------------------------------------------------------------------------
create table public.instances (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.cases (id) on delete restrict,
  template_id       uuid not null,
  template_version  integer not null,
  label             text not null check (length(btrim(label)) > 0),
  data              jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status            text not null default 'open' check (status in ('open', 'settled')),
  created_by        uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id),
  updated_at        timestamptz not null default now(),
  deleted_by        uuid references public.profiles (id),
  deleted_at        timestamptz,
  foreign key (template_id, template_version) references public.templates (id, version) on delete restrict,
  check ((deleted_at is null) = (deleted_by is null))
);
create index instances_case_id_idx on public.instances (case_id) where deleted_at is null;
create index instances_template_id_idx on public.instances (template_id);

-- ---------------------------------------------------------------------------
-- revisions: append-only field history. Written only by trigger.
-- ---------------------------------------------------------------------------
create table public.revisions (
  id           bigint generated always as identity primary key,
  instance_id  uuid not null references public.instances (id) on delete restrict,
  field_key    text not null,
  old_value    jsonb,
  new_value    jsonb,
  changed_by   uuid references public.profiles (id),
  changed_at   timestamptz not null default now()
);
create index revisions_instance_idx on public.revisions (instance_id, changed_at desc);
create index revisions_instance_field_idx on public.revisions (instance_id, field_key, changed_at desc);
comment on column public.revisions.field_key is
  'Positional field key (s03_f02, s06_t1_r2_c1, ...) or _label for the instance label.';

-- ---------------------------------------------------------------------------
-- attachments: photos and documents in the private "attachments" bucket.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  instance_id   uuid not null references public.instances (id) on delete restrict,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  uploaded_by   uuid not null default auth.uid() references public.profiles (id),
  uploaded_at   timestamptz not null default now(),
  deleted_by    uuid references public.profiles (id),
  deleted_at    timestamptz,
  check ((deleted_at is null) = (deleted_by is null))
);
create index attachments_instance_idx on public.attachments (instance_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- delete_log: who deleted or restored what, and when. Append-only.
-- ---------------------------------------------------------------------------
create table public.delete_log (
  id         bigint generated always as identity primary key,
  entity     text not null check (entity in ('case', 'instance', 'attachment')),
  entity_id  uuid not null,
  action     text not null check (action in ('delete', 'restore')),
  label      text,
  actor      uuid references public.profiles (id),
  at         timestamptz not null default now()
);
create index delete_log_at_idx on public.delete_log (at desc);

-- ---------------------------------------------------------------------------
-- login_attempts: lockout and reset throttling. Only the server (secret key)
-- touches this. kind = 'password' (sign-in), 'mfa' (authenticator code), or
-- 'reset' (reset email requested).
-- ---------------------------------------------------------------------------
create table public.login_attempts (
  id         bigint generated always as identity primary key,
  kind       text not null default 'password' check (kind in ('password', 'mfa', 'reset')),
  email      text not null,
  ip         text,
  succeeded  boolean not null,
  at         timestamptz not null default now()
);
create index login_attempts_email_idx on public.login_attempts (kind, email, at desc);
create index login_attempts_ip_idx on public.login_attempts (kind, ip, at desc);
