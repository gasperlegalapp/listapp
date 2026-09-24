'use server'

import { redirect } from 'next/navigation'
import { getAuth, requireUser } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import type { FormState } from '@/lib/form-state'
import type { Value, Values } from '@/lib/templates/values'

// Autosave actions never redirect: a lapsed session comes back as an error
// the form can show while it keeps the unsaved text on screen.

export type SaveResult = { ok: true; updatedAt: string } | { ok: false; error: string; signedOut?: boolean }

const KEY_RE = /^[a-z0-9_]{1,64}$/

function validValue(v: unknown): v is Value | null {
  if (v === null) return true
  if (typeof v === 'string') return v.length <= 20000
  return Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === 'string' && /^opt\d{1,3}$/.test(x))
}

export async function saveField(instanceId: string, key: string, value: Value | null): Promise<SaveResult> {
  if (!isUuid(instanceId) || !KEY_RE.test(key) || !validValue(value)) return { ok: false, error: 'That change was not valid.' }
  const auth = await getAuth()
  if (!auth.ok) return { ok: false, error: 'You are signed out.', signedOut: true }
  const { data, error } = await auth.supabase.rpc('set_instance_field', {
    p_instance_id: instanceId,
    p_key: key,
    p_value: value,
  })
  if (error) {
    console.error('saveField failed', { key, code: error.code, message: error.message })
    if (error.code === 'P0002') return { ok: false, error: 'This list was deleted or you no longer have access.' }
    return { ok: false, error: 'We could not save that change.' }
  }
  return { ok: true, updatedAt: data as string }
}

export type PollResult =
  | { ok: true; data: Values; label: string; updatedAt: string; updatedBy: string | null }
  | { ok: false; signedOut?: boolean }

// The list as it is now, for merging other people's saves. Compared by value
// on the client, not by timestamp: two saves landing in the same instant
// must still both show up.
export async function pollInstance(instanceId: string): Promise<PollResult> {
  if (!isUuid(instanceId)) return { ok: false }
  const auth = await getAuth()
  if (!auth.ok) return { ok: false, signedOut: true }
  const { data } = await auth.supabase
    .from('instances')
    .select('data, label, updated_at, updated_by')
    .eq('id', instanceId)
    .is('deleted_at', null)
    .maybeSingle<{ data: Values; label: string; updated_at: string; updated_by: string | null }>()
  if (!data) return { ok: false }
  let updatedBy: string | null = null
  if (data.updated_by && data.updated_by !== auth.profile.id) {
    const { data: p } = await auth.supabase.from('profiles').select('full_name').eq('id', data.updated_by).maybeSingle()
    updatedBy = p?.full_name ?? null
  }
  return { ok: true, data: data.data, label: data.label, updatedAt: data.updated_at, updatedBy }
}

export type HistoryEntry = { id: number; key: string; old: unknown; new: unknown; by: string; at: string }

export async function loadHistory(instanceId: string): Promise<{ entries: HistoryEntry[] } | { error: string }> {
  if (!isUuid(instanceId)) return { error: 'List not found.' }
  const auth = await getAuth()
  if (!auth.ok) return { error: 'You are signed out.' }
  const { data, error } = await auth.supabase
    .from('revisions')
    .select('id, field_key, old_value, new_value, changed_by, changed_at')
    .eq('instance_id', instanceId)
    .order('id', { ascending: false })
    .limit(500)
  if (error) return { error: 'We could not load the history.' }
  const ids = [...new Set((data ?? []).map((r) => r.changed_by).filter(Boolean))] as string[]
  const { data: people } = ids.length
    ? await auth.supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string; email: string }[] }
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))
  return {
    entries: (data ?? []).map((r) => ({
      id: r.id,
      key: r.field_key,
      old: r.old_value,
      new: r.new_value,
      by: r.changed_by ? (name.get(r.changed_by) ?? 'Unknown') : 'System',
      at: r.changed_at,
    })),
  }
}

export async function revertField(revisionId: number): Promise<SaveResult> {
  if (!Number.isInteger(revisionId)) return { ok: false, error: 'Not found.' }
  const auth = await getAuth()
  if (!auth.ok) return { ok: false, error: 'You are signed out.', signedOut: true }
  if (auth.profile.role === 'staff') return { ok: false, error: 'Only attorneys and admins can revert.' }
  const { data, error } = await auth.supabase.rpc('revert_field', { p_revision_id: revisionId })
  if (error) return { ok: false, error: `We could not revert: ${error.message}` }
  return { ok: true, updatedAt: data as string }
}

export async function renameInstance(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser()
  const id = formData.get('id')
  const label = String(formData.get('label') ?? '').trim().slice(0, 200)
  if (!isUuid(id)) return { error: 'List not found.' }
  if (!label) return { error: 'The list needs a name.' }
  const { error } = await supabase.from('instances').update({ label }).eq('id', id)
  if (error) return { error: `We could not rename it: ${error.message}` }
  redirect(`/l/${id}`)
}

export async function deleteInstance(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile } = await requireUser()
  const id = formData.get('id')
  const caseId = formData.get('case_id')
  if (!isUuid(id) || !isUuid(caseId)) return { error: 'List not found.' }
  if (profile.role === 'staff') return { error: 'Only attorneys and admins can delete.' }
  const { error } = await supabase.from('instances').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: `We could not delete it: ${error.message}` }
  redirect(`/cases/${caseId}`)
}
