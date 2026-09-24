'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { REMEMBER_COOKIE, isProd } from '@/lib/session-policy'
import type { FormState } from '@/lib/form-state'

// Invite and reset links land on a page with a button rather than verifying on
// GET: email security scanners (Microsoft Safe Links, Mimecast) open links
// before the person does, which would burn the one-time token.
export async function confirmToken(_: FormState, formData: FormData): Promise<FormState> {
  const tokenHash = String(formData.get('token_hash') ?? '')
  const type = String(formData.get('type') ?? '')
  if (!tokenHash || (type !== 'invite' && type !== 'recovery')) {
    return { error: 'This link is incomplete. Open it again from the email.' }
  }
  const supabase = await createClient({ remember: false })
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) {
    return {
      error:
        type === 'invite'
          ? 'This invitation has expired or was already used. Ask an admin to send a new one.'
          : 'This reset link has expired or was already used. Request a new one from the sign-in page.',
    }
  }
  const cookieStore = await cookies()
  cookieStore.set(REMEMBER_COOKIE, '0', { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' })
  redirect(type === 'invite' ? '/account/password?welcome=1' : '/account/password')
}
