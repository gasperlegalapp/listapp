// End-to-end auth checks against a running app + Supabase (local or a
// throwaway project; never production). Creates users and writes to the DB.
//
//   APP_URL=http://localhost:3000 SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
//   E2E_DATABASE_URL=postgres://... node tests/e2e/auth.e2e.mjs
//
// Set RESEND_API_KEY in the app to an invalid key: the invite step expects the
// email send to fail and be reported.
import { chromium, devices } from 'playwright'
import crypto from 'node:crypto'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const need = (k) => {
  if (!process.env[k]) throw new Error(`Set ${k}`)
  return process.env[k]
}
const BASE = process.env.APP_URL || 'http://localhost:3000'
const API = need('SUPABASE_URL')
const SK = need('SUPABASE_SECRET_KEY')
const DB = need('E2E_DATABASE_URL')
const OUT = process.env.E2E_SCREENSHOTS || os.tmpdir()
const PW = 'correct horse battery staple'
const sql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q]).toString().trim()
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })

let passed = 0
function ok(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
  console.log('PASS:', msg)
}
async function admin(path, method = 'GET', body) {
  const r = await fetch(`${API}/auth/v1${path}`, {
    method,
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`)
  return j
}
function totp(secret, t = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(t / 30000)))
  const h = crypto.createHmac('sha1', key).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
async function waitNextWindow() {
  const ms = 30000 - (Date.now() % 30000) + 500
  await new Promise((r) => setTimeout(r, ms))
}
async function login(page, email, password, { remember = false, next } = {}) {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`)
  await page.fill('#email', email)
  await page.fill('#password', password)
  if (remember) await page.check('input[name=remember]', { force: true })
  await page.click('button[type=submit]')
}

try {
  // Fixtures
  await admin('/admin/users', 'POST', { email: 'chris@example.com', password: PW, email_confirm: true, user_metadata: { full_name: 'Christopher Gasper' } })
  await admin('/admin/users', 'POST', { email: 'lock@example.com', password: PW, email_confirm: true, user_metadata: { full_name: 'Lock Test' } })
  sql("update public.profiles set role = 'admin' where email = 'chris@example.com'")
  ok(sql("select role from public.profiles where email = 'chris@example.com'") === 'admin', 'first admin bootstrapped with one SQL statement')

  const browser = await chromium.launch()
  const A = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const a = await A.newPage()
  a.on('dialog', (d) => d.accept())

  // Signed-out deep link goes to login with next, then back after sign-in.
  await a.goto(`${BASE}/l/3f1c2a9e-0000-4000-8000-000000000001`)
  ok(new URL(a.url()).pathname === '/login' && new URL(a.url()).searchParams.get('next') === '/l/3f1c2a9e-0000-4000-8000-000000000001',
    'signed-out list URL redirects to /login?next=<that URL>')
  await shot(a, '01-login-desktop')
  await a.fill('#email', 'chris@example.com')
  await a.fill('#password', PW)
  await a.click('button[type=submit]')
  await a.waitForURL((u) => u.pathname.startsWith('/l/'))
  ok(a.url().endsWith('/l/3f1c2a9e-0000-4000-8000-000000000001'), 'after sign-in, lands on the exact list URL')

  const cookies = await A.cookies()
  const sb = cookies.filter((c) => c.name.startsWith('sb-'))
  ok(sb.length > 0 && sb.every((c) => c.httpOnly), 'Supabase session cookies are httpOnly')
  ok(sb.every((c) => c.expires === -1), 'without remember me, session cookies expire with the browser')

  await a.goto(`${BASE}/`)
  ok((await a.locator('.idx').count()) === 6, 'home shows six checklist cards from the database')
  ok((await a.locator('nav >> text=Users').count()) === 1, 'admin sees the Users link')
  await shot(a, '02-home-admin')

  // Invite a staff member. Resend key is fake, so the email step must fail loudly.
  await a.goto(`${BASE}/admin/users`)
  await a.fill('#full_name', 'Sam Staff')
  await a.fill('#email', 'sam@example.com')
  await a.selectOption('#role', 'staff')
  await a.getByRole('button', { name: 'Send invite', exact: true }).click()
  await a.locator('.formerr').first().waitFor()
  ok(/invite email failed/i.test(await a.locator('.formerr').first().innerText()), 'failed invite email is reported to the admin, not swallowed')
  await a.reload()
  const samRow = a.locator('tr', { hasText: 'sam@example.com' })
  ok((await samRow.locator('text=Invite pending').count()) === 1, 'invited user listed as Invite pending')
  ok(sql("select role from public.profiles where email = 'sam@example.com'") === 'staff', 'invited user has the chosen role')
  await shot(a, '03-admin-users')

  // Accept the invite on a phone-sized screen.
  const link = await admin('/admin/generate_link', 'POST', { type: 'invite', email: 'sam@example.com' })
  const hashed = link.hashed_token || link.properties?.hashed_token
  ok(!!hashed, 'invite link generated for an existing pending user')
  const B = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  const b = await B.newPage()
  await b.goto(`${BASE}/auth/confirm?token_hash=${hashed}&type=invite`)
  ok(sql("select count(*) from auth.users where email = 'sam@example.com' and last_sign_in_at is not null") === '0',
    'opening the invite link (GET) does not consume the token')
  await shot(b, '04-invite-mobile')
  await b.getByRole('button', { name: 'Continue', exact: true }).click()
  await b.waitForURL('**/account/password?welcome=1')
  await b.fill('#password', 'short')
  await b.fill('#confirm', 'short')
  await b.evaluate(() => document.querySelectorAll('input[minlength]').forEach((i) => i.removeAttribute('minlength')))
  await b.getByRole('button', { name: 'Save password', exact: true }).click()
  await b.locator('.formerr').waitFor()
  ok(/12 characters/.test(await b.locator('.formerr').innerText()), 'short password rejected server-side')
  await b.fill('#password', 'a long enough staff password')
  await b.fill('#confirm', 'a long enough staff password')
  await b.getByRole('button', { name: 'Save password', exact: true }).click()
  await b.waitForURL(BASE + '/')
  ok((await b.locator('.idx').count()) === 6, 'staff lands on home after setting password')
  ok((await b.locator('nav >> text=Users').count()) === 0, 'staff does not see the Users link')
  const overflow = await b.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(overflow <= 0, 'no horizontal scroll at 390px')
  await shot(b, '05-home-staff-mobile')
  await b.goto(`${BASE}/admin/users`)
  ok(new URL(b.url()).pathname === '/', 'staff visiting /admin/users is sent home')

  // Deactivate Sam; Sam's next request ends the session.
  await a.goto(`${BASE}/admin/users`)
  await a.locator('tr', { hasText: 'sam@example.com' }).locator('button', { hasText: 'Deactivate' }).click()
  await a.locator('.formmsg', { hasText: 'Deactivated' }).waitFor()
  ok(sql("select active from public.profiles where email = 'sam@example.com'") === 'f', 'deactivate sets active = false')
  ok(sql("select banned_until > now() + interval '50 years' from auth.users where email = 'sam@example.com'") === 't', 'deactivate also bans sign-in at the auth layer')
  await b.goto(`${BASE}/`)
  await b.waitForURL((u) => u.pathname === '/login' && u.searchParams.get('reason') === 'inactive')
  ok((await b.locator('text=deactivated').count()) === 1, 'deactivated user is signed out with an explanation')
  await login(b, 'sam@example.com', 'a long enough staff password')
  await b.locator('.formerr').waitFor()
  ok(/deactivated/.test(await b.locator('.formerr').innerText()), 'deactivated user cannot sign back in')

  // Lockout
  const C = await browser.newContext()
  const c = await C.newPage()
  for (let i = 0; i < 5; i++) {
    await login(c, 'lock@example.com', 'wrong password ' + i)
    await c.locator('.formerr').waitFor()
  }
  ok(/incorrect/.test(await c.locator('.formerr').innerText()), 'wrong password gets a generic message')
  await login(c, 'lock@example.com', PW)
  await c.locator('.formerr').waitFor()
  ok(/Too many unsuccessful attempts/.test(await c.locator('.formerr').innerText()), 'after 5 failures even the right password is refused')
  ok(new URL(c.url()).pathname === '/login', 'locked user stays on login')

  // Remember me
  const D = await browser.newContext()
  const d = await D.newPage()
  await login(d, 'chris@example.com', PW, { remember: true })
  await d.waitForURL(BASE + '/')
  const dsb = (await D.cookies()).filter((x) => x.name.startsWith('sb-'))
  const days = (dsb[0].expires - Date.now() / 1000) / 86400
  ok(days > 2.9 && days < 3.1, `remember me keeps the session cookie ~3 days (${days.toFixed(2)})`)
  await D.close()

  // Forgot password never reveals whether an account exists.
  await c.goto(`${BASE}/login/forgot`)
  await c.fill('#email', 'nobody@example.com')
  await c.click('button[type=submit]')
  await c.locator('.formmsg').waitFor()
  const generic = await c.locator('.formmsg').innerText()
  await c.goto(`${BASE}/login/forgot`)
  await c.fill('#email', 'chris@example.com')
  await c.click('button[type=submit]')
  await c.locator('.formmsg').waitFor()
  ok(generic === (await c.locator('.formmsg').innerText()), 'reset gives the same answer for real and unknown emails')

  // MFA: enroll, then sign-in requires the code.
  await a.goto(`${BASE}/account/security`)
  await a.getByRole('button', { name: 'Set up authenticator app', exact: true }).click()
  await a.locator('.secret').waitFor()
  const secret = (await a.locator('.secret').innerText()).trim()
  await shot(a, '06-mfa-enroll')
  await a.fill('#code', totp(secret))
  await a.getByRole('button', { name: 'Turn it on', exact: true }).click()
  await a.waitForURL(BASE + '/')
  ok(sql("select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = 'chris@example.com' and f.status = 'verified'") === '1',
    'TOTP factor enrolled and verified')

  await a.locator('nav button', { hasText: 'Sign out' }).click()
  await a.waitForURL('**/login?reason=signedout')
  await login(a, 'chris@example.com', PW)
  await a.waitForURL('**/login/mfa**')
  ok(true, 'sign-in with an enrolled authenticator goes to the code page')
  await a.goto(`${BASE}/admin/users`)
  await a.waitForURL('**/login/mfa')
  ok(true, 'aal1 session cannot reach app pages')
  await a.fill('#code', '000000')
  await a.getByRole('button', { name: 'Verify', exact: true }).click()
  await a.locator('.formerr').waitFor()
  ok(/did not work/.test(await a.locator('.formerr').innerText()), 'wrong code rejected')
  await waitNextWindow()
  await a.fill('#code', totp(secret))
  await a.getByRole('button', { name: 'Verify', exact: true }).click()
  await a.waitForURL(BASE + '/')
  ok((await a.locator('.idx').count()) === 6, 'correct code completes sign-in (aal2)')

  await browser.close()
  console.log(`\n${passed} end-to-end checks passed.`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
