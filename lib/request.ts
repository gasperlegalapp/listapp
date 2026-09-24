import 'server-only'
import { headers } from 'next/headers'

// End-user IP. On Vercel, x-real-ip and x-forwarded-for are set by the edge
// and cannot be spoofed by the client.
export async function clientIp(): Promise<string | null> {
  const h = await headers()
  const real = h.get('x-real-ip')
  if (real) return real.trim()
  const fwd = h.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : null
}
