'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import type { FormState } from '@/lib/form-state'

const TABLE = { case: 'cases', instance: 'instances', attachment: 'attachments' } as const

// Undo a soft delete. The database checks the rest: only attorneys and admins,
// a list only once its matter is back, and it logs the restore.
export async function restoreItem(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireRole('admin', 'attorney')
  const entity = String(formData.get('entity') ?? '') as keyof typeof TABLE
  const id = formData.get('id')
  if (!TABLE[entity] || !isUuid(id)) return { error: 'Not found.' }
  const { data, error } = await supabase
    .from(TABLE[entity])
    .update({ deleted_at: null })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id')
  if (error) {
    if (error.message.includes('restore the matter first')) return { error: 'Restore its matter first.' }
    return { error: `We could not restore it: ${error.message}` }
  }
  if (!data?.length) return { error: 'It was already restored.' }
  revalidatePath('/admin/deleted')
  return { message: 'Restored.' }
}
