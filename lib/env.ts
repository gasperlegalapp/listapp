import 'server-only'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`)
  return v
}

// Read lazily so `next build` works without secrets present.
export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL')
  },
  get supabasePublishableKey() {
    return required('SUPABASE_PUBLISHABLE_KEY')
  },
  get supabaseSecretKey() {
    return required('SUPABASE_SECRET_KEY')
  },
  get resendApiKey() {
    return required('RESEND_API_KEY')
  },
  get emailFrom() {
    return required('EMAIL_FROM')
  },
  get appUrl() {
    return required('APP_URL').replace(/\/+$/, '')
  },
  get mfaRequired() {
    return process.env.MFA_REQUIRED === 'true'
  },
}
