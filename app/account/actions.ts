'use server'

import { redirect } from 'next/navigation'
import { requireSession, requireUser } from '@/lib/auth'
import { env } from '@/lib/env'
import { safeNext } from '@/lib/session-policy'
import type { FormState } from '@/lib/form-state'

export async function setPassword(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireSession()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  if (password.length < 12) return { error: 'Use at least 12 characters. A short sentence works well.' }
  if (password.length > 256) return { error: 'That password is too long.' }
  if (password !== confirm) return { error: 'The two passwords do not match.' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'insufficient_aal') redirect('/login/mfa?next=/account/password')
    if (error.code === 'weak_password') return { error: 'That password is known to be weak or leaked. Choose another.' }
    if (error.code === 'same_password') return { error: 'Choose a different password from your current one.' }
    return { error: `We could not save your password: ${error.message}` }
  }
  redirect('/')
}

export type EnrollState = FormState & { factorId?: string; qr?: string; secret?: string }

export async function startEnroll(): Promise<EnrollState> {
  const { supabase } = await requireUser({ allowMissingMfa: true })
  const { data: factors } = await supabase.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: 'Gasper Legal List App',
  })
  if (error || !data) return { error: `We could not start setup: ${error?.message ?? 'unknown error'}` }
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

export async function confirmEnroll(prev: EnrollState, formData: FormData): Promise<EnrollState> {
  const { supabase } = await requireUser({ allowMissingMfa: true })
  const factorId = String(formData.get('factorId') ?? '')
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '')
  const next = safeNext(formData.get('next'))
  if (!/^\d{6}$/.test(code)) return { ...prev, error: 'Enter the 6-digit code your app shows for List App.' }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) return { ...prev, error: 'That code did not match. Check the time on your phone and try the current code.' }
  redirect(next)
}

export async function removeFactor(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireUser()
  if (env.mfaRequired) return { error: 'The firm requires an authenticator app, so it cannot be turned off.' }
  const factorId = String(formData.get('factorId') ?? '')
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { error: `We could not remove it: ${error.message}` }
  redirect('/account/security')
}
