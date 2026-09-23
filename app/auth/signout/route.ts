import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { REMEMBER_COOKIE } from '@/lib/session-policy'

const REASONS = new Set(['inactive', 'expired'])

async function signOut(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  const reason = request.nextUrl.searchParams.get('reason')
  const to = new URL('/login', request.url)
  to.searchParams.set('reason', reason && REASONS.has(reason) ? reason : 'signedout')
  const res = NextResponse.redirect(to, { status: 303 })
  res.cookies.delete(REMEMBER_COOKIE)
  return res
}

// POST from the Sign out button. GET only for server-side redirects
// (a deactivated account); signing someone out is the worst it can do.
export const POST = signOut
export const GET = signOut
