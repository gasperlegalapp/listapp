import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
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

type Options = {
  // Let a signed-in user without an authenticator reach the enrollment page
  // even when MFA_REQUIRED is on.
  allowMissingMfa?: boolean
}

// Server-side gate for every authenticated page and server action. The proxy
// already bounced signed-out visitors; this re-checks, loads the profile
// through RLS, and enforces deactivation and MFA. Postgres enforces the same
// rules again in RLS, so a bug here fails closed.
export const requireUser = cache(async (opts: Options = {}) => {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims) redirect('/login')

  // Passing the token makes Supabase check enrolled factors with the auth
  // server instead of trusting the user object cached in the cookie.
  const { data: sessionData } = await supabase.auth.getSession()
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(sessionData.session?.access_token)
  if (!aal) redirect('/auth/signout?reason=expired')
  if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/login/mfa')
  if (env.mfaRequired && !opts.allowMissingMfa && aal.nextLevel !== 'aal2') redirect('/account/security?required=1')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, active')
    .eq('id', claims.sub)
    .maybeSingle<Profile>()
  if (!profile || !profile.active) redirect('/auth/signout?reason=inactive')

  return { supabase, profile, claims }
})

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
