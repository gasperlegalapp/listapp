'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { MATTER_TYPES, OUR_ROLES } from '@/lib/templates/matter'
import type { FormState } from '@/lib/form-state'

const CODES = ['GL-A1', 'GL-A2', 'GL-A3', 'GL-A4', 'GL-A5', 'GL-A6']

function readCase(formData: FormData) {
  const s = (k: string, max = 300) => {
    const v = String(formData.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const matterType = s('matter_type')
  const ourRole = s('our_role')
  const date = s('valuation_date')
  return {
    name: s('name', 300),
    case_number: s('case_number', 100),
    county: s('county', 100),
    court: s('court', 200),
    matter_type: MATTER_TYPES.some(([k]) => k === matterType) ? matterType : null,
    our_role: OUR_ROLES.some(([k]) => k === ourRole) ? ourRole : null,
    ward_or_decedent: s('ward_or_decedent', 300),
    valuation_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  }
}

export async function createCase(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser()
  const c = readCase(formData)
  if (!c.name) return { error: 'Give the matter a name, e.g. "Blair, Gary M. -- Guardianship".' }
  if (!c.matter_type) return { error: 'Pick the matter type.' }
  const { data, error } = await supabase.from('cases').insert(c).select('id').single()
  if (error || !data) return { error: `We could not create the matter: ${error?.message ?? 'unknown error'}` }
  redirect(`/cases/${data.id}`)
}

export async function updateCase(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser()
  const id = formData.get('id')
  if (!isUuid(id)) return { error: 'Matter not found.' }
  const c = readCase(formData)
  if (!c.name) return { error: 'The matter needs a name.' }
  if (!c.matter_type) return { error: 'Pick the matter type.' }
  const status = formData.get('status') === 'closed' ? 'closed' : 'open'
  const { error } = await supabase.from('cases').update({ ...c, status }).eq('id', id)
  if (error) return { error: `We could not save the matter: ${error.message}` }
  revalidatePath(`/cases/${id}`)
  return { message: 'Saved. Every list in this matter now shows the new details.' }
}

export async function deleteCase(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile } = await requireUser()
  const id = formData.get('id')
  if (!isUuid(id)) return { error: 'Matter not found.' }
  if (profile.role === 'staff') return { error: 'Only attorneys and admins can delete.' }
  const { error } = await supabase.from('cases').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) {
    if (error.code === '23503') return { error: 'Delete this matter\'s lists first. We never delete a matter that still has lists.' }
    return { error: `We could not delete the matter: ${error.message}` }
  }
  redirect('/')
}

export async function createInstance(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser()
  const caseId = formData.get('case_id')
  const code = String(formData.get('code') ?? '')
  const label = String(formData.get('label') ?? '').trim().slice(0, 200)
  if (!isUuid(caseId)) return { error: 'Matter not found.' }
  if (!CODES.includes(code)) return { error: 'Pick which checklist.' }
  if (!label) return { error: 'Name the list so people can tell it apart, e.g. "3453 Hoover Rd" or "2014 Honda CR-V".' }

  const { data: t, error: tErr } = await supabase
    .from('templates')
    .select('id, version')
    .eq('code', code)
    .order('version', { ascending: false })
    .limit(1)
    .single()
  if (tErr || !t) return { error: 'We could not find that checklist.' }

  const { data, error } = await supabase
    .from('instances')
    .insert({ case_id: caseId, template_id: t.id, template_version: t.version, label })
    .select('id')
    .single()
  if (error || !data) return { error: `We could not create the list: ${error?.message ?? 'unknown error'}` }
  redirect(`/l/${data.id}`)
}
