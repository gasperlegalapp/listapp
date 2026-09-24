'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, type Role } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmLink, sendInvite } from '@/lib/email'
import type { FormState } from '@/lib/form-state'

const ROLES: Role[] = ['admin', 'attorney', 'staff']
const BAN_FOREVER = '876000h' // 100 years

export async function inviteUser(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireRole('admin')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? 'staff') as Role
  if (!email.includes('@')) return { error: 'Enter an email address.' }
  if (!fullName) return { error: 'Enter their name.' }
  if (!ROLES.includes(role)) return { error: 'Pick a role.' }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { full_name: fullName } },
  })
  if (error || !data.user || !data.properties?.hashed_token) {
    if (error?.code === 'email_exists') return { error: 'That email already has an account. Use Resend invite below.' }
    return { error: `We could not create the account: ${error?.message ?? 'unknown error'}` }
  }

  // Role and name through RLS as the admin, not the secret key.
  const { error: roleError } = await supabase.from('profiles').update({ role, full_name: fullName }).eq('id', data.user.id)
  revalidatePath('/admin/users')
  if (roleError) return { error: `Account created, but setting the role failed: ${roleError.message}` }

  const sent = await sendInvite(email, fullName, confirmLink(data.properties.hashed_token, 'invite'))
  if (!sent.ok) {
    return { error: `Account created, but the invite email failed: ${sent.error}. Fix the email settings, then use Resend invite.` }
  }
  return { message: `Invite sent to ${email}.` }
}

export async function resendInvite(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole('admin')
  const id = String(formData.get('id') ?? '')
  const admin = createAdminClient()
  const { data: u, error: getError } = await admin.auth.admin.getUserById(id)
  if (getError || !u.user?.email) return { error: 'User not found.' }
  const email = u.user.email
  const name = String(u.user.user_metadata?.full_name ?? '')
  // Never signed in: fresh invite. Otherwise a reset link does the same job.
  const type = u.user.last_sign_in_at ? 'recovery' : 'invite'
  const { data, error } =
    type === 'invite'
      ? await admin.auth.admin.generateLink({ type: 'invite', email })
      : await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (error || !data.properties?.hashed_token) return { error: `We could not create a link: ${error?.message ?? 'unknown'}` }
  const sent = await sendInvite(email, name, confirmLink(data.properties.hashed_token, type))
  if (!sent.ok) return { error: `Email failed: ${sent.error}` }
  return { message: `Sent to ${email}.` }
}

export async function setRole(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile } = await requireRole('admin')
  const id = String(formData.get('id') ?? '')
  const role = String(formData.get('role') ?? '') as Role
  if (!ROLES.includes(role)) return { error: 'Pick a role.' }
  if (id === profile.id) return { error: 'You cannot change your own role.' }
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
  revalidatePath('/admin/users')
  return error ? { error: error.message } : { message: 'Saved.' }
}

export async function setActive(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase, profile } = await requireRole('admin')
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (id === profile.id) return { error: 'You cannot deactivate yourself.' }

  // Database first: once active = false, RLS returns nothing to that user even
  // if the ban below fails or their current access token is still valid.
  const { error } = await supabase.from('profiles').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  const admin = createAdminClient()
  const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : BAN_FOREVER })
  revalidatePath('/admin/users')
  if (banError) return { error: `Saved, but blocking sign-in failed: ${banError.message}. RLS still blocks their data.` }
  return { message: active ? 'Reactivated.' : 'Deactivated. Their history stays.' }
}

export async function resetMfa(_: FormState, formData: FormData): Promise<FormState> {
  await requireRole('admin')
  const id = String(formData.get('id') ?? '')
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id })
  if (error) return { error: error.message }
  for (const f of data.factors) {
    const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ userId: id, id: f.id })
    if (delError) return { error: delError.message }
  }
  revalidatePath('/admin/users')
  return { message: 'Authenticator removed. They will set up a new one at next sign-in.' }
}
