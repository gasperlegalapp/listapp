import type { Metadata } from 'next'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { CASE_COLUMNS, matterValues, type CaseRecord } from '@/lib/templates/matter'
import type { TemplateSchema } from '@/lib/templates/types'
import type { Values } from '@/lib/templates/values'
import { ChecklistForm } from '@/components/checklist/checklist-form'

type Inst = {
  id: string
  case_id: string
  template_id: string
  label: string
  data: Values
  updated_at: string
  deleted_at: string | null
}

// THE pasteable URL. Loads straight into the filled form. Cached so the
// page and its metadata share one set of queries.
const load = cache(async (id: string) => {
  if (!isUuid(id)) return null
  const { supabase, profile } = await requireUser()
  const { data: inst } = await supabase
    .from('instances')
    .select('id, case_id, template_id, label, data, updated_at, deleted_at')
    .eq('id', id)
    .maybeSingle<Inst>()
  if (!inst || inst.deleted_at) return null
  const [{ data: tpl }, { data: c }] = await Promise.all([
    supabase.from('templates').select('schema').eq('id', inst.template_id).single<{ schema: TemplateSchema }>(),
    supabase.from('cases').select(CASE_COLUMNS).eq('id', inst.case_id).single<CaseRecord>(),
  ])
  if (!tpl || !c) return null
  return { inst, schema: tpl.schema, c, profile }
})

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id)
  return { title: r ? `${r.inst.label} - ${r.schema.code} | List App` : 'List App' }
}

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await load((await params).id)
  if (!r) notFound()
  const { inst, schema, c, profile } = r
  return (
    <ChecklistForm
      key={inst.id}
      instanceId={inst.id}
      caseId={c.id}
      caseName={c.name}
      label={inst.label}
      data={inst.data}
      schema={schema}
      matter={matterValues(c)}
      canDelete={profile.role !== 'staff'}
      canRevert={profile.role !== 'staff'}
    />
  )
}
