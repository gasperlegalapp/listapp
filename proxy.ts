import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { REMEMBER_COOKIE, authCookieOptions, sessionExpired } from '@/lib/session-policy'

// Runs before every page and server action. Refreshes the Supabase session,
// enforces the session lifetime, and sends signed-out visitors to /login with
// a `next` parameter so a pasted list URL lands back on that exact list.

const PUBLIC_PATHS = ['/login', '/login/forgot', '/auth/confirm']

function isPublic(pathname: string) {
  return PUBLIC_PATHS.includes(pathname)
}

export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    return new NextResponse('Server is not configured. See SETUP.md.', { status: 500 })
  }

  const remember = request.cookies.get(REMEMBER_COOKIE)?.value === '1'
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, authCookieOptions(options, remember))
        }
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v)
      },
    },
  })

  // Do not put code between createServerClient and getClaims: getClaims is
  // what refreshes an expired access token.
  const { data, error } = await supabase.auth.getClaims()
  let claims = data?.claims ?? null
  let reason: 'expired' | 'inactive' | null = null

  if (claims && sessionExpired(claims, remember)) reason = 'expired'
  // A deactivated user is banned in Supabase Auth; depending on the project's
  // JWT keys that surfaces here (token check) or in requireUser (profile).
  if (!claims && error?.code === 'user_banned') reason = 'inactive'
  if (reason) {
    await supabase.auth.signOut({ scope: 'local' })
    response.cookies.delete(REMEMBER_COOKIE)
    claims = null
  }

  const { pathname, search } = request.nextUrl

  if (!claims && !isPublic(pathname)) {
    const to = request.nextUrl.clone()
    to.pathname = '/login'
    to.search = ''
    if (pathname !== '/') to.searchParams.set('next', pathname + search)
    if (reason) to.searchParams.set('reason', reason)
    return redirectWithCookies(to, response)
  }

  if (claims && pathname === '/login') {
    const to = request.nextUrl.clone()
    to.pathname = '/'
    to.search = ''
    return redirectWithCookies(to, response)
  }

  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function redirectWithCookies(to: URL, from: NextResponse) {
  const res = NextResponse.redirect(to)
  for (const c of from.cookies.getAll()) res.cookies.set(c)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
}
