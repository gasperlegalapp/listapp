// Session lifetime rules, shared by proxy.ts (runs before every request) and
// server code. No 'server-only' import: proxy.ts runs in its own bundle.

export const REMEMBER_COOKIE = 'gl_remember'

// "Remember me": up to 3 days from sign-in. Otherwise a browser-session
// cookie, capped at 12 hours from sign-in even if the browser stays open.
export const REMEMBER_MAX_AGE_S = 3 * 24 * 60 * 60
export const SESSION_MAX_AGE_S = 12 * 60 * 60

export const isProd = process.env.NODE_ENV === 'production'

type CookieOpts = {
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none' | boolean
  path?: string
  domain?: string
}

// Supabase's SSR helper writes 400-day, script-readable cookies. We only use
// Supabase from the server, so every auth cookie is httpOnly and lives no
// longer than the session policy allows.
export function authCookieOptions<T extends CookieOpts>(options: T | undefined, remember: boolean): T {
  const o = { ...(options ?? {}) } as T
  o.httpOnly = true
  o.secure = isProd
  o.sameSite = 'lax'
  o.path = '/'
  const removing = o.maxAge === 0 || (o.expires instanceof Date && o.expires.getTime() <= Date.now())
  if (!removing) {
    delete o.expires
    if (remember) o.maxAge = REMEMBER_MAX_AGE_S
    else delete o.maxAge
  }
  return o
}

// Seconds since the user last proved who they are with a password, invite or
// reset link, taken from the signed JWT's amr claim (survives token refresh).
export function sessionAgeSeconds(claims: { amr?: unknown; iat?: unknown } | null | undefined): number | null {
  if (!claims) return null
  const amr = Array.isArray(claims.amr) ? (claims.amr as { method?: string; timestamp?: number }[]) : []
  const firstFactor = amr.filter((a) => a.method !== 'totp' && typeof a.timestamp === 'number')
  const ts = firstFactor.length ? Math.min(...firstFactor.map((a) => a.timestamp as number)) : null
  if (ts === null) return null
  return Math.floor(Date.now() / 1000) - ts
}

export function sessionExpired(claims: { amr?: unknown } | null | undefined, remember: boolean): boolean {
  const age = sessionAgeSeconds(claims)
  if (age === null) return false
  return age > (remember ? REMEMBER_MAX_AGE_S : SESSION_MAX_AGE_S)
}

// Only same-origin relative paths are allowed as post-login destinations.
export function safeNext(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string') return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return fallback
  return raw
}
