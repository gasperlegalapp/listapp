import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadAttachments, loadInstance } from '@/lib/instances'
import { matterValues } from '@/lib/templates/matter'
import { ChecklistForm } from '@/components/checklist/checklist-form'

// THE pasteable URL. Loads straight into the filled form.

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await loadInstance((await params).id)
  return { title: r ? `${r.inst.label} - ${r.schema.code} | List App` : 'List App' }
}

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadInstance((await params).id)
  if (!r) notFound()
  const { inst, schema, c, profile, supabase } = r
  const attachments = await loadAttachments(supabase, inst.id)
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
      attachments={attachments}
      canDelete={profile.role !== 'staff'}
      canRevert={profile.role !== 'staff'}
    />
  )
}
