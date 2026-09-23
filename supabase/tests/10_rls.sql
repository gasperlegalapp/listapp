-- RLS and trigger tests. Runs after all migrations against the stub in
-- 00_supabase_stub.sql. Every check raises on failure; a clean run prints
-- nothing but PASS notices.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema test;
grant usage on schema test to authenticated, anon;

-- Switch identity. Call as superuser; follow with `set role authenticated`.
create function test.claims(p_user uuid, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, false);
$$;
grant execute on function test.claims(uuid, text) to authenticated;

create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'PASS: %', p_msg;
end $$;
grant execute on function test.ok(boolean, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'Chris@Example.com', '{"full_name":"Christopher Gasper"}'),
  ('00000000-0000-0000-0000-00000000000b', 'atty@example.com',  '{"full_name":"Alex Attorney"}'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@example.com', '{"full_name":"Sam Staff"}'),
  ('00000000-0000-0000-0000-00000000000d', 'gone@example.com',  '{"full_name":"Former Staff"}'),
  ('00000000-0000-0000-0000-00000000000e', 'mfa@example.com',   '{"full_name":"Morgan MFA"}');

select test.ok((select count(*) = 5 from public.profiles), 'profiles are created for new auth users');
select test.ok((select role = 'staff' and email = 'chris@example.com' and full_name = 'Christopher Gasper'
                from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
               'new profile defaults to staff, lowercased email, name from invite');

-- Bootstrap the first admin the way SETUP.md does it (SQL editor = postgres).
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set role = 'attorney' where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set active = false where id = '00000000-0000-0000-0000-00000000000d';
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000e', 'verified');

select test.ok((select count(*) = 6 from public.templates where version = 1), 'six templates seeded at version 1');

-- ---------------------------------------------------------------------------
-- anon: no table access at all
-- ---------------------------------------------------------------------------
set role anon;
do $$ begin
  begin
    perform 1 from public.instances;
    raise exception 'FAIL: anon read instances';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot read instances'; end;
  begin
    perform 1 from public.login_attempts;
    raise exception 'FAIL: anon read login_attempts';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot read login_attempts'; end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Staff creates a matter and two GL-A1 lists
-- ---------------------------------------------------------------------------
select test.claims('00000000-0000-0000-0000-00000000000c');
set role authenticated;

insert into public.cases (id, name, matter_type, created_by)
values ('10000000-0000-0000-0000-000000000001', 'Blair, Gary M. -- Guardianship', 'guardianship',
        '00000000-0000-0000-0000-00000000000a'); -- spoofed creator is overwritten

select test.ok((select created_by = '00000000-0000-0000-0000-00000000000c'
                from public.cases where id = '10000000-0000-0000-0000-000000000001'),
               'case created_by is forced to the caller');

insert into public.instances (id, case_id, template_id, template_version, label)
select '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', id, version, '3453 Hoover Rd'
from public.templates where code = 'GL-A1' and version = 1;
insert into public.instances (id, case_id, template_id, template_version, label)
select '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', id, version, '12 Elm St'
from public.templates where code = 'GL-A1' and version = 1;

-- Six fields on the first property.
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f01', '"3453 Hoover Rd"');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f02', '"Grove City, OH 43123"');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f06', '"opt1"');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f08', '["opt1","opt3"]');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 'first', '["opt2"]');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's06_t1_r1_c1', '"AEP Ohio"');
-- One field on the second.
select public.set_instance_field('20000000-0000-0000-0000-000000000002', 's01_f01', '"12 Elm St"');

select test.ok((select count(*) = 6 from jsonb_object_keys(
                  (select data from public.instances where id = '20000000-0000-0000-0000-000000000001'))),
               'all six fields persisted on the first list');
select test.ok((select data = '{"s01_f01":"12 Elm St"}'::jsonb
                from public.instances where id = '20000000-0000-0000-0000-000000000002'),
               'second list is independent (no bleed-through)');
select test.ok((select count(*) = 6 from public.revisions
                where instance_id = '20000000-0000-0000-0000-000000000001'
                  and changed_by = '00000000-0000-0000-0000-00000000000c'),
               'each field change wrote one revision attributed to staff');

-- Insurance "Named insured is the estate / guardianship" (s04_f11): No -> Yes
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's04_f11', '"opt2"');
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's04_f11', '"opt1"');
select test.ok((select old_value = '"opt2"' and new_value = '"opt1"'
                from public.revisions r
                where instance_id = '20000000-0000-0000-0000-000000000001' and field_key = 's04_f11'
                order by id desc limit 1),
               'insurance No -> Yes recorded in history');

-- Clearing a field removes the key and is logged.
select public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f02', '""');
select test.ok((select not (data ? 's01_f02') from public.instances where id = '20000000-0000-0000-0000-000000000001'),
               'empty string clears the field');
select test.ok((select new_value is null from public.revisions
                where field_key = 's01_f02' order by id desc limit 1),
               'clearing is logged with a null new value');

-- Label rename is logged as _label.
update public.instances set label = '3453 Hoover Road' where id = '20000000-0000-0000-0000-000000000001';
select test.ok((select old_value = '"3453 Hoover Rd"' from public.revisions where field_key = '_label'),
               'label change is logged');

-- Value validation.
do $$ begin
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 's99_f01', '"x"');
    raise exception 'FAIL: unknown key accepted';
  exception when invalid_parameter_value then raise notice 'PASS: unknown key rejected'; end;
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f06', '"opt99"');
    raise exception 'FAIL: bad option accepted';
  exception when invalid_parameter_value then raise notice 'PASS: out-of-range option rejected'; end;
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f06', '["opt1"]');
    raise exception 'FAIL: array accepted for single choice';
  exception when invalid_parameter_value then raise notice 'PASS: array rejected for single-select'; end;
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f01', '{"x":1}');
    raise exception 'FAIL: object accepted for text';
  exception when invalid_parameter_value then raise notice 'PASS: object rejected for text'; end;
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 'bad key', '"x"');
    raise exception 'FAIL: malformed key accepted';
  exception when invalid_parameter_value then raise notice 'PASS: malformed key rejected'; end;
end $$;

-- Direct writes that must fail for staff.
do $$ begin
  begin update public.instances set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: staff soft-deleted a list';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot delete a list'; end;
  begin delete from public.instances where id = '20000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: staff hard-deleted a list';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot hard-delete'; end;
  begin update public.instances set template_version = 2 where id = '20000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: template_version changed';
  exception when insufficient_privilege or foreign_key_violation then raise notice 'PASS: template_version is immutable'; end;
  begin insert into public.revisions (instance_id, field_key) values ('20000000-0000-0000-0000-000000000001', 'x');
    raise exception 'FAIL: staff inserted a revision';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot forge revisions'; end;
  begin update public.revisions set new_value = '"x"';
    raise exception 'FAIL: staff edited revisions';
  exception when insufficient_privilege then raise notice 'PASS: revisions are read-only to staff'; end;
  begin update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'FAIL: staff promoted self';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot change own role'; end;
  begin insert into public.templates (code, name, version, schema, accent)
        select code, name, 2, schema, accent from public.templates where code = 'GL-A1';
    raise exception 'FAIL: staff published a template';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot publish templates'; end;
  begin perform public.revert_field((select max(id) from public.revisions));
    raise exception 'FAIL: staff reverted';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot revert'; end;
  begin perform public.login_lockout_seconds('x', 'y', 'password');
    raise exception 'FAIL: staff called lockout fn';
  exception when insufficient_privilege then raise notice 'PASS: lockout function is server-only'; end;
  begin perform 1 from public.login_attempts;
    raise exception 'FAIL: staff read login_attempts';
  exception when insufficient_privilege then raise notice 'PASS: staff cannot read login_attempts'; end;
end $$;

update public.profiles set full_name = 'Samantha Staff' where id = '00000000-0000-0000-0000-00000000000c';
select test.ok((select full_name = 'Samantha Staff' from public.profiles where id = '00000000-0000-0000-0000-00000000000c'),
               'staff can edit own name');
select test.ok((select count(*) = 0 from public.delete_log), 'staff cannot read the delete log');
reset role;

-- ---------------------------------------------------------------------------
-- Attorney: delete, see deleted, revert
-- ---------------------------------------------------------------------------
select test.claims('00000000-0000-0000-0000-00000000000b');
set role authenticated;

do $$ begin
  begin update public.cases set deleted_at = now() where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: deleted a case with live lists';
  exception when foreign_key_violation then raise notice 'PASS: case with live lists cannot be deleted'; end;
end $$;

update public.instances set deleted_at = now() where id = '20000000-0000-0000-0000-000000000002';
select test.ok((select deleted_by = '00000000-0000-0000-0000-00000000000b'
                from public.instances where id = '20000000-0000-0000-0000-000000000002'),
               'attorney soft-deleted a list; deleted_by stamped');
select test.ok((select count(*) = 1 from public.delete_log
                where entity = 'instance' and action = 'delete'
                  and entity_id = '20000000-0000-0000-0000-000000000002'
                  and actor = '00000000-0000-0000-0000-00000000000b' and label = '12 Elm St'),
               'deletion is logged with who and which list');

do $$ begin
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000002', 's01_f01', '"x"');
    raise exception 'FAIL: wrote to a deleted list';
  exception when no_data_found then raise notice 'PASS: deleted list cannot be edited'; end;
end $$;

select public.revert_field((select id from public.revisions
                            where field_key = 's04_f11' and new_value = '"opt1"'));
select test.ok((select data ->> 's04_f11' = 'opt2' from public.instances where id = '20000000-0000-0000-0000-000000000001'),
               'attorney reverted one field');
select test.ok((select changed_by = '00000000-0000-0000-0000-00000000000b' from public.revisions order by id desc limit 1),
               'revert is itself logged as a new revision');
reset role;

-- Staff can no longer see the deleted list at all.
select test.claims('00000000-0000-0000-0000-00000000000c');
set role authenticated;
select test.ok((select count(*) = 0 from public.instances where id = '20000000-0000-0000-0000-000000000002'),
               'staff gets nothing back for a deleted list URL');
select test.ok((select count(*) = 0 from public.revisions where instance_id = '20000000-0000-0000-0000-000000000002'),
               'staff gets no history for a deleted list');
reset role;

-- ---------------------------------------------------------------------------
-- Deactivated user and MFA
-- ---------------------------------------------------------------------------
select test.claims('00000000-0000-0000-0000-00000000000d');
set role authenticated;
select test.ok((select count(*) = 0 from public.instances), 'deactivated user sees no lists');
select test.ok((select count(*) = 0 from public.templates), 'deactivated user sees no templates');
select test.ok((select count(*) = 1 from public.profiles), 'deactivated user sees only own profile');
do $$ begin
  begin perform public.set_instance_field('20000000-0000-0000-0000-000000000001', 's01_f01', '"x"');
    raise exception 'FAIL: deactivated user wrote';
  exception when no_data_found then raise notice 'PASS: deactivated user cannot write'; end;
end $$;
reset role;

select test.claims('00000000-0000-0000-0000-00000000000e', 'aal1');
set role authenticated;
select test.ok((select count(*) = 0 from public.instances), 'enrolled MFA user on aal1 sees nothing');
reset role;
select test.claims('00000000-0000-0000-0000-00000000000e', 'aal2');
set role authenticated;
select test.ok((select count(*) = 1 from public.instances), 'enrolled MFA user on aal2 sees lists');
reset role;

-- Signed-in JWT for a user with no profile at all.
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', false);
set role authenticated;
select test.ok((select count(*) = 0 from public.instances), 'unknown user sees nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Admin: roles and template versions
-- ---------------------------------------------------------------------------
select test.claims('00000000-0000-0000-0000-00000000000a');
set role authenticated;

update public.profiles set role = 'attorney' where id = '00000000-0000-0000-0000-00000000000c';
select test.ok((select role = 'attorney' from public.profiles where id = '00000000-0000-0000-0000-00000000000c'),
               'admin can change another user''s role');
update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  begin update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: admin demoted self';
  exception when insufficient_privilege then raise notice 'PASS: admin cannot demote self'; end;
end $$;

insert into public.templates (code, name, version, schema, accent)
select code, name, 2, schema, accent from public.templates where code = 'GL-A1' and version = 1;
select test.ok((select count(*) = 2 from public.templates where code = 'GL-A1'), 'admin published GL-A1 v2');
select test.ok((select template_version = 1 and data ->> 's01_f01' = '3453 Hoover Rd'
                from public.instances where id = '20000000-0000-0000-0000-000000000001'),
               'existing v1 list still on v1 and intact after v2 publish');

do $$ begin
  begin insert into public.templates (code, name, version, schema, accent)
        select code, name, 5, schema, accent from public.templates where code = 'GL-A1' and version = 1;
    raise exception 'FAIL: skipped a version';
  exception when check_violation then raise notice 'PASS: versions must be sequential'; end;
  begin insert into public.instances (case_id, template_id, template_version, label)
        select '10000000-0000-0000-0000-000000000001', id, version, 'Stale'
        from public.templates where code = 'GL-A1' and version = 1;
    raise exception 'FAIL: created a list on a stale version';
  exception when check_violation then raise notice 'PASS: new lists must use the latest version'; end;
end $$;
reset role;

-- Templates are immutable even for the database owner.
do $$ begin
  begin update public.templates set name = 'x' where code = 'GL-A1';
    raise exception 'FAIL: template updated';
  exception when insufficient_privilege then raise notice 'PASS: templates cannot be updated, even by postgres'; end;
  begin delete from public.templates where code = 'GL-A1' and version = 2;
    raise exception 'FAIL: template deleted';
  exception when insufficient_privilege then raise notice 'PASS: templates cannot be deleted'; end;
  begin update public.revisions set new_value = null;
    raise exception 'FAIL: revisions updated';
  exception when insufficient_privilege then raise notice 'PASS: revisions are append-only, even for postgres'; end;
end $$;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
select test.claims('00000000-0000-0000-0000-00000000000c');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('attachments', '20000000-0000-0000-0000-000000000001/p1.jpg');
select test.ok((select count(*) = 0 from storage.objects), 'object without an attachments row is unreadable');
insert into public.attachments (instance_id, storage_path, file_name, mime_type, size_bytes)
values ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001/p1.jpg', 'kitchen.jpg', 'image/jpeg', 1234);
select test.ok((select count(*) = 1 from storage.objects), 'object readable once attached to a visible list');
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('attachments', '20000000-0000-0000-0000-000000000002/p2.jpg');
    raise exception 'FAIL: uploaded to a deleted list';
  exception when insufficient_privilege then raise notice 'PASS: cannot upload to a deleted list'; end;
  begin insert into storage.objects (bucket_id, name) values ('attachments', 'not-a-list/p3.jpg');
    raise exception 'FAIL: uploaded outside a list folder';
  exception when insufficient_privilege then raise notice 'PASS: cannot upload outside a list folder'; end;
  begin delete from storage.objects;
    if found then raise exception 'FAIL: staff deleted an object'; end if;
    raise notice 'PASS: staff cannot delete storage objects';
  end;
  begin update public.attachments set deleted_at = now();
    if found then raise exception 'FAIL: staff deleted an attachment'; end if;
    raise notice 'PASS: staff cannot delete attachments';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Login lockout (server-only function)
-- ---------------------------------------------------------------------------
insert into public.login_attempts (email, ip, succeeded)
select 'staff@example.com', '203.0.113.9', false from generate_series(1, 4);
select test.ok(public.login_lockout_seconds('staff@example.com', '203.0.113.9') = 0, 'four failures: not locked');
insert into public.login_attempts (email, ip, succeeded) values ('staff@example.com', '203.0.113.9', false);
select test.ok(public.login_lockout_seconds('STAFF@example.com', '198.51.100.1') between 890 and 900,
               'five failures: email locked for ~15 minutes');
insert into public.login_attempts (email, ip, succeeded, at) values ('staff@example.com', '203.0.113.9', true, now() + interval '1 second');
select test.ok(public.login_lockout_seconds('staff@example.com', '198.51.100.1', 'mfa') = 0, 'password failures do not lock MFA');
insert into public.login_attempts (email, ip, succeeded, at) values ('staff@example.com', '203.0.113.9', true, now() + interval '1 second');
select test.ok(public.login_lockout_seconds('staff@example.com', '198.51.100.1') = 0, 'a success resets the email counter');
insert into public.login_attempts (email, ip, succeeded)
select 'other' || g || '@example.com', '203.0.113.50', false from generate_series(1, 20) g;
select test.ok(public.login_lockout_seconds('new@example.com', '203.0.113.50') > 0, 'twenty failures from one IP lock that IP');

\echo 'RLS tests complete.'
