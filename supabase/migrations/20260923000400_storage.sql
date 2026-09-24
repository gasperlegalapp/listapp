-- Private bucket for photos and documents attached to a list.
-- Object path: <instance_id>/<random uuid>.<ext>
-- Nobody can read an object unless a live attachments row points at it and
-- they can see that row. Nobody can overwrite or delete an object through the
-- API: removal is a soft delete of the attachments row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400, -- 25 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.app_role()) is not null
    and exists (select 1 from public.attachments a where a.storage_path = name)
  );

create policy attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select private.app_role()) is not null
    and exists (
      select 1 from public.instances i
      where i.id::text = (storage.foldername(name))[1]
        and i.deleted_at is null
    )
  );
