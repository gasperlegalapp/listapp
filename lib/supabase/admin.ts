import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

// Secret-key client. Bypasses row-level security. Use only for things a user
// session cannot do: creating users, generating email links, banning, and the
// login_attempts table. Never pass its results to the browser wholesale.
export function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
