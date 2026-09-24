import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'
import { REMEMBER_COOKIE, authCookieOptions } from '@/lib/session-policy'

type Options = {
  // Override the remember-me choice (used at sign-in, before the cookie exists).
  remember?: boolean
  // Use the secret key and forward the end user's IP so Supabase rate-limits
  // sign-in per person rather than per Vercel server. Sign-in only.
  forwardedFor?: string | null
}

// Supabase client acting as the signed-in user. Row-level security applies.
// Session lives in httpOnly cookies; the browser never talks to Supabase.
export async function createClient(opts: Options = {}) {
  const cookieStore = await cookies()
  const remember = opts.remember ?? cookieStore.get(REMEMBER_COOKIE)?.value === '1'
  const key = opts.forwardedFor !== undefined ? env.supabaseSecretKey : env.supabasePublishableKey
  return createServerClient(env.supabaseUrl, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, authCookieOptions(options, remember))
          }
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
    global: opts.forwardedFor ? { headers: { 'Sb-Forwarded-For': opts.forwardedFor } } : undefined,
  })
}
