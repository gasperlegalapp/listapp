import 'server-only'
import { Resend } from 'resend'
import { env } from '@/lib/env'

// All auth email goes through Resend, not Supabase's built-in sender, so
// failures come back to us as errors instead of disappearing.

export type SendResult = { ok: true } | { ok: false; error: string }

async function send(to: string, subject: string, text: string, html: string): Promise<SendResult> {
  try {
    const resend = new Resend(env.resendApiKey)
    const { error } = await resend.emails.send({ from: env.emailFrom, to, subject, text, html })
    if (error) {
      console.error('email send failed', { to, subject, error })
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('email send threw', { to, subject, message })
    return { ok: false, error: message }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function layout(title: string, body: string, link: string, button: string) {
  return `<!doctype html><html><body style="margin:0;background:#FCFCFA;font-family:Georgia,serif;color:#16201C">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<div style="font-family:Arial,sans-serif;font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Gasper Legal</div>
<h1 style="font-family:Arial,sans-serif;font-size:24px;margin:18px 0 10px">${esc(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#16201C;color:#FCFCFA;padding:10px 16px;border-radius:4px;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;font-size:14px">${esc(button)}</a></p>
<p style="font-size:13px;color:#7C8A82">If the button does not work, paste this address into your browser:<br>${esc(link)}</p>
</div></body></html>`
}

export function sendInvite(to: string, name: string, link: string) {
  const greeting = name ? `Hi ${name},` : 'Hello,'
  const text = `${greeting}

We have set up your account for the Gasper Legal List App, where we keep our asset, income and budget checklists.

Set your password here (the link expires in 24 hours):
${link}

If you were not expecting this, you can ignore it.

Gasper Legal`
  const html = layout(
    'Your List App account',
    `<p>${esc(greeting)}</p><p>We have set up your account for the Gasper Legal List App, where we keep our asset, income and budget checklists. The link expires in 24 hours.</p>`,
    link,
    'Set your password',
  )
  return send(to, 'Your Gasper Legal List App account', text, html)
}

export function sendPasswordReset(to: string, link: string) {
  const text = `We received a request to reset your List App password.

Choose a new password here (the link works once and expires in 24 hours):
${link}

If you did not ask for this, you can ignore it. Your password has not changed.

Gasper Legal`
  const html = layout(
    'Reset your password',
    `<p>We received a request to reset your List App password. The link works once and expires in 24 hours.</p><p>If you did not ask for this, you can ignore it. Your password has not changed.</p>`,
    link,
    'Choose a new password',
  )
  return send(to, 'Reset your List App password', text, html)
}

export function confirmLink(tokenHash: string, type: 'invite' | 'recovery') {
  const u = new URL('/auth/confirm', env.appUrl)
  u.searchParams.set('token_hash', tokenHash)
  u.searchParams.set('type', type)
  return u.toString()
}
