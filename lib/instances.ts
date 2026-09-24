import 'server-only'
import { cache } from 'react'
import { requireUser } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import type { Attachment } from '@/lib/attachments'
import { CASE_COLUMNS, type CaseRecord } from '@/lib/templates/matter'
import type { TemplateSchema } from '@/lib/templates/types'
import type { Values } from '@/lib/templates/values'

export type Inst = {
  id: string
  case_id: string
  template_id: string
  template_version: number
  label: string
  data: Values
  updated_at: string
  deleted_at: string | null
}

// One list with its template version and matter, read through RLS as the
// signed-in user. Null when it does not exist, is deleted, or they cannot see
// it. Cached per request so a page and its metadata share the queries.
export const loadInstance = cache(async (id: string) => {
  if (!isUuid(id)) return null
  const { supabase, profile } = await requireUser()
  const { data: inst } = await supabase
    .from('instances')
    .select('id, case_id, template_id, template_version, label, data, updated_at, deleted_at')
    .eq('id', id)
    .maybeSingle<Inst>()
  if (!inst || inst.deleted_at) return null
  const [{ data: tpl }, { data: c }] = await Promise.all([
    supabase.from('templates').select('schema').eq('id', inst.template_id).single<{ schema: TemplateSchema }>(),
    supabase.from('cases').select(CASE_COLUMNS).eq('id', inst.case_id).single<CaseRecord>(),
  ])
  if (!tpl || !c) return null
  return { inst, schema: tpl.schema, c, profile, supabase }
})

// Live photos and documents on a list, oldest first, with uploader names.
export async function loadAttachments(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  instanceId: string,
): Promise<Attachment[]> {
  const { data } = await supabase
    .from('attachments')
    .select('id, file_name, mime_type, size_bytes, uploaded_at, uploaded_by')
    .eq('instance_id', instanceId)
    .is('deleted_at', null)
    .order('uploaded_at')
    .returns<(Omit<Attachment, 'uploaded_by'> & { uploaded_by: string })[]>()
  const rows = data ?? []
  const ids = [...new Set(rows.map((r) => r.uploaded_by))]
  const { data: people } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string; email: string }[] }
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))
  return rows.map((r) => ({ ...r, uploaded_by: name.get(r.uploaded_by) ?? 'Unknown' }))
}
