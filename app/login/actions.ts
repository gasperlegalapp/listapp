'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clientIp } from '@/lib/request'
import { confirmLink, sendPasswordReset } from '@/lib/email'
import { REMEMBER_COOKIE, REMEMBER_MAX_AGE_S, isProd, safeNext } from '@/lib/session-policy'
import { requireSession } from '@/lib/auth'
import type { FormState } from '@/lib/form-state'

const LOCKED = (s: number) =>
  `Too many unsuccessful attempts. For security we have paused sign-in for this account. Try again in ${Math.max(1, Math.ceil(s / 60))} minute${s > 60 ? 's' : ''}.`

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const remember = formData.get('remember') === 'on'
  const next = safeNext(formData.get('next'))
  if (!email || !password) return { error: 'Enter your email and password.' }
  if (email.length > 320 || password.length > 1024) return { error: 'Email or password is incorrect.' }

  const ip = await clientIp()
  const admin = createAdminClient()
  const { data: wait, error: gateError } = await admin.rpc('login_lockout_seconds', {
    p_email: email,
    p_ip: ip,
    p_kind: 'password',
  })
  if (gateError) {
    // Fail closed: if we cannot check the lockout, we do not try the password.
    console.error('lockout check failed', gateError)
    return { error: 'We cannot sign anyone in right now. Try again in a minute.' }
  }
  if ((wait ?? 0) > 0) return { error: LOCKED(wait) }

  const supabase = await createClient({ remember, forwardedFor: ip })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  await admin.from('login_attempts').insert({ kind: 'password', email, ip, succeeded: !error })

  if (error || !data.session) {
    if (error?.code === 'user_banned') return { error: 'This account has been deactivated. Ask an admin if you need access.' }
    if (error?.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' }
    return { error: 'Email or password is incorrect.' }
  }

  const cookieStore = await cookies()
  cookieStore.set(REMEMBER_COOKIE, remember ? '1' : '0', {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: REMEMBER_MAX_AGE_S } : {}),
  })

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    redirect(`/login/mfa?next=${encodeURIComponent(next)}`)
  }
  redirect(next)
}

export async function verifyMfa(_: FormState, formData: FormData): Promise<FormState> {
  const { supabase, claims } = await requireSession()
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '')
  const next = safeNext(formData.get('next'))
  if (!/^\d{6}$/.test(code)) return { error: 'Enter the 6-digit code from your authenticator app.' }

  const email = String(claims.email ?? claims.sub).toLowerCase()
  const ip = await clientIp()
  const admin = createAdminClient()
  const { data: wait, error: gateError } = await admin.rpc('login_lockout_seconds', {
    p_email: email,
    p_ip: ip,
    p_kind: 'mfa',
  })
  if (gateError) {
    console.error('mfa lockout check failed', gateError)
    return { error: 'We cannot verify codes right now. Try again in a minute.' }
  }
  if ((wait ?? 0) > 0) return { error: LOCKED(wait) }

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const factor = factors?.totp?.[0]
  if (!factor) redirect(next)

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
  await admin.from('login_attempts').insert({ kind: 'mfa', email, ip, succeeded: !error })
  if (error) return { error: 'That code did not work. Codes change every 30 seconds; enter the one showing now.' }
  redirect(next)
}

export async function requestReset(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email || !email.includes('@') || email.length > 320) return { error: 'Enter your email address.' }
  // Same answer whether or not the account exists.
  const done: FormState = {
    message: 'If that address belongs to an active account, we have emailed a reset link. It works once and expires in 24 hours.',
  }

  const ip = await clientIp()
  const admin = createAdminClient()
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = (col: 'email' | 'ip', val: string) =>
    admin
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'reset')
      .eq(col, val)
      .gte('at', since)
  const [byEmail, byIp] = await Promise.all([recent('email', email), ip ? recent('ip', ip) : Promise.resolve({ count: 0 })])
  if ((byEmail.count ?? 0) >= 3 || (byIp.count ?? 0) >= 10) return done
  await admin.from('login_attempts').insert({ kind: 'reset', email, ip, succeeded: true })

  const { data: profile } = await admin.from('profiles').select('active').eq('email', email).maybeSingle()
  if (!profile?.active) return done

  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (error || !data.properties?.hashed_token) {
    console.error('recovery link failed', { email, error })
    return done
  }
  const sent = await sendPasswordReset(email, confirmLink(data.properties.hashed_token, 'recovery'))
  if (!sent.ok) console.error('recovery email failed', { email, error: sent.error })
  return done
}
