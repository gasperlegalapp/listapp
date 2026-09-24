import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'

export type Role = 'admin' | 'attorney' | 'staff'

export type Profile = {
  id: string
  full_name: string
  email: string
  role: Role
  active: boolean
}

type Me = Profile & { mfa_enrolled: boolean }

export type AuthResult =
  | { ok: true; supabase: SupabaseClient; profile: Profile; aal: string }
  | { ok: false; reason: 'signed-out' | 'inactive' | 'mfa' | 'mfa-setup' }

// Who is calling, without redirecting. Server actions that autosave use this
// so a lapsed session returns an error the form can show, instead of
// navigating away mid-typing. Cached per request.
export const getAuth = cache(async (allowMissingMfa: boolean = false): Promise<AuthResult> => {
  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims) {
    if (claimsError) console.warn('auth: no valid session', { code: claimsError.code, message: claimsError.message })
    return { ok: false, reason: 'signed-out' }
  }

  const { data: me, error } = await supabase.rpc('whoami').maybeSingle<Me>()
  if (error) {
    // Not a sign-in problem; do not log the person out over it.
    console.error('auth: whoami failed', { code: error.code, message: error.message })
    throw new Error('We could not load your account. Reload the page to try again.')
  }
  if (!me || !me.active) return { ok: false, reason: 'inactive' }

  const aal = typeof claims.aal === 'string' ? claims.aal : 'aal1'
  if (me.mfa_enrolled && aal !== 'aal2') return { ok: false, reason: 'mfa' }
  if (env.mfaRequired && !allowMissingMfa && !me.mfa_enrolled) return { ok: false, reason: 'mfa-setup' }

  const { mfa_enrolled: _, ...profile } = me
  void _
  return { ok: true, supabase, profile: profile as Profile, aal }
})

// Server-side gate for every authenticated page. The proxy already bounced
// signed-out visitors; this re-checks, loads the profile through RLS, and
// enforces deactivation and MFA. Postgres enforces the same rules again in
// RLS, so a bug here fails closed.
export async function requireUser(opts: { allowMissingMfa?: boolean } = {}) {
  const auth = await getAuth(!!opts.allowMissingMfa)
  if (!auth.ok) {
    if (auth.reason === 'signed-out') redirect('/login')
    if (auth.reason === 'inactive') {
      console.warn('auth: refused inactive or unknown profile')
      redirect('/auth/signout?reason=inactive')
    }
    if (auth.reason === 'mfa') redirect('/login/mfa')
    redirect('/account/security?required=1')
  }
  return { supabase: auth.supabase, profile: auth.profile }
}

export async function requireRole(...roles: Role[]) {
  const ctx = await requireUser()
  if (!roles.includes(ctx.profile.role)) redirect('/')
  return ctx
}

// For pages that need a session but not a full member: setting a password
// after an invite or reset link, and the MFA challenge.
export async function requireSession() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  return { supabase, claims: data.claims }
}
