'use server'

import { randomUUID } from 'node:crypto'
import { getAuth } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, cleanFileName, type Attachment } from '@/lib/attachments'

// Photos go straight from the browser to Supabase Storage on a one-time
// signed upload URL, because Vercel caps request bodies at 4.5 MB and phone
// photos are often bigger. Our server decides who may upload and where:
//
//   1. startUpload: checks the list and the file, picks a random path under
//      the list's folder, and signs an upload URL for that one path. Storage
//      checks the signed-in user's insert rights (RLS) before it signs.
//   2. The browser PUTs the file to that URL.
//   3. finishUpload: confirms the object really landed, takes its size and
//      type from Storage (not from the browser), and records it in
//      attachments as the user. Until then nobody can read the file.

export type StartResult = { ok: true; path: string; url: string } | { ok: false; error: string }
export type FinishResult = { ok: true; attachment: Attachment } | { ok: false; error: string }

const PATH_RE = /^([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$/

export async function startUpload(
  instanceId: string,
  file: { name: string; type: string; size: number },
): Promise<StartResult> {
  if (!isUuid(instanceId)) return { ok: false, error: 'List not found.' }
  const ext = ATTACHMENT_TYPES[file?.type]
  if (!ext) return { ok: false, error: `${cleanFileName(file?.name)}: only photos (JPEG, PNG, WebP, HEIC) and PDFs can be added.` }
  if (!(file.size > 0) || file.size > MAX_ATTACHMENT_BYTES)
    return { ok: false, error: `${cleanFileName(file.name)} is over 25 MB.` }

  const auth = await getAuth()
  if (!auth.ok) return { ok: false, error: 'You are signed out. Sign in again, then add the photo.' }
  const { data: inst } = await auth.supabase
    .from('instances')
    .select('id')
    .eq('id', instanceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!inst) return { ok: false, error: 'This list was deleted or you no longer have access.' }

  const path = `${instanceId}/${randomUUID()}.${ext}`
  const { data, error } = await auth.supabase.storage.from('attachments').createSignedUploadUrl(path)
  if (error || !data) {
    console.error('photos: sign upload failed', { message: error?.message })
    return { ok: false, error: 'We could not start the upload. Try again.' }
  }
  return { ok: true, path, url: data.signedUrl }
}

export async function finishUpload(instanceId: string, path: string, fileName: string): Promise<FinishResult> {
  const m = PATH_RE.exec(String(path))
  if (!isUuid(instanceId) || !m || m[1] !== instanceId) return { ok: false, error: 'That upload was not valid.' }
  const auth = await getAuth()
  if (!auth.ok) return { ok: false, error: 'You are signed out. Sign in again, then add the photo again.' }

  // What actually landed. The admin client is needed only because nobody can
  // read an object before its attachments row exists.
  const { data: info, error: infoError } = await createAdminClient().storage.from('attachments').info(path)
  if (infoError || !info) return { ok: false, error: 'The upload did not finish. Try again.' }
  const size = Number(info.size)
  const type = String(info.contentType ?? '')
  if (!ATTACHMENT_TYPES[type] || !(size > 0)) return { ok: false, error: 'That file type is not allowed.' }

  const { data: row, error } = await auth.supabase
    .from('attachments')
    .insert({ instance_id: instanceId, storage_path: path, file_name: cleanFileName(fileName), mime_type: type, size_bytes: size })
    .select('id, file_name, mime_type, size_bytes, uploaded_at')
    .single()
  if (error || !row) {
    console.error('photos: attachment insert failed', { code: error?.code, message: error?.message })
    return { ok: false, error: 'We could not save the photo to this list.' }
  }
  return {
    ok: true,
    attachment: { ...row, uploaded_by: auth.profile.full_name || auth.profile.email },
  }
}

export async function deleteAttachment(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: 'Not found.' }
  const auth = await getAuth()
  if (!auth.ok) return { ok: false, error: 'You are signed out.' }
  if (auth.profile.role === 'staff') return { ok: false, error: 'Only attorneys and admins can delete.' }
  const { data, error } = await auth.supabase
    .from('attachments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error || !data?.length) return { ok: false, error: 'We could not delete it.' }
  return { ok: true }
}
