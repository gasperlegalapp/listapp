'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import type { FormState } from '@/lib/form-state'
import { diffLines, outline, warningsChanged } from '@/lib/templates/outline'
import type { TemplateSchema } from '@/lib/templates/types'
import { checkTemplate, sameTemplate } from '@/lib/templates/validate'

// Publish a checklist revision as version N+1. The browser converted the
// uploaded file; here we trust none of it: checkTemplate rebuilds and
// re-derives the whole schema, and the database refuses anything but the
// next version number and never changes a published version.
export async function publishTemplate(schemaJson: string, confirmWarnings: boolean): Promise<FormState> {
  const { supabase } = await requireRole('admin')
  if (typeof schemaJson !== 'string' || schemaJson.length > 900_000) return { error: 'That checklist is too large.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(schemaJson)
  } catch {
    return { error: 'That checklist could not be read.' }
  }
  const checked = checkTemplate(parsed)
  if (!checked.ok) return { error: `Not published. ${checked.error}` }
  const s = checked.schema

  const { data: latest } = await supabase
    .from('templates')
    .select('version, schema')
    .eq('code', s.code)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number; schema: TemplateSchema }>()
  if (!latest) return { error: `${s.code} is not one of our checklists. This page revises existing checklists only.` }
  if (sameTemplate(latest.schema, s)) return { error: `${s.code} has no changes from version ${latest.version}.` }
  if (warningsChanged(diffLines(outline(latest.schema), outline(s))) && !confirmWarnings)
    return { error: 'A standing warning changed. Read it, tick the box to confirm, and publish again.' }

  const version = latest.version + 1
  const { error } = await supabase.from('templates').insert({ code: s.code, name: s.title, version, schema: s, accent: s.accent })
  if (error) {
    if (error.code === '23505' || error.message.includes('next version'))
      return { error: 'Someone else published this checklist a moment ago. Reload the page and check again.' }
    return { error: `We could not publish: ${error.message}` }
  }
  revalidatePath('/admin/templates')
  revalidatePath('/')
  return { message: `Published ${s.code} version ${version}. New lists use it from now on; existing lists keep their version.` }
}
