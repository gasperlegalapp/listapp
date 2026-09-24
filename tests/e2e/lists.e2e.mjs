// End-to-end checks for matters, lists and the checklist form, including the
// spec's acceptance tests. Same environment as auth.e2e.mjs; creates its own
// users so it can run after it against the same database.
//
//   APP_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... E2E_DATABASE_URL=... \
//   node tests/e2e/lists.e2e.mjs

import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

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
const RUN = Date.now().toString(36)

const sql = (q) => execFileSync('psql', ['-X', '-qtA', DB, '-c', q]).toString().trim()
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
let passed = 0
function ok(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  passed++
  console.log('PASS:', msg)
}
async function createUser(email, name, role) {
  const r = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { full_name: name } }),
  })
  if (!r.ok) throw new Error(`create ${email}: ${r.status} ${await r.text()}`)
  sql(`update public.profiles set role = '${role}' where email = '${email}'`)
}
async function login(page, email, next) {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`)
  await page.fill('#email', email)
  await page.fill('#password', PW)
  await page.click('button[type=submit]')
}
const btn = (page, name) => page.getByRole('button', { name, exact: true })
async function saved(page) {
  await page.locator('.savestate.saved').waitFor({ timeout: 15000 })
}
async function until(check, msg, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('FAIL (timeout): ' + msg)
}
const exact = (t) => new RegExp(`^\\s*${t}\\s*$`)
const listIdFromUrl = (u) => new URL(u).pathname.split('/').pop()
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

const STAFF = `staff-${RUN}@example.com`
const ATTY = `atty-${RUN}@example.com`

try {
  await createUser(STAFF, 'Sam Staff', 'staff')
  await createUser(ATTY, 'Alex Attorney', 'attorney')

  const browser = await chromium.launch()
  const S = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const s = await S.newPage()
  s.on('dialog', (d) => d.accept())
  await login(s, STAFF)
  await s.waitForURL(BASE + '/')

  // ---- Matter ----
  await s.locator('summary', { hasText: 'New matter' }).click()
  await s.fill('#cf-name', 'Blair, Gary M. -- Guardianship')
  await s.fill('#cf-num', '2026 GRD 00123')
  await s.locator('label.chip', { hasText: 'Guardianship' }).first().click()
  await s.locator('label.chip', { hasText: 'Guardian of estate' }).click()
  await s.fill('#cf-county', 'Franklin')
  await s.fill('#cf-date', '2026-09-01')
  await btn(s, 'Create matter').click()
  await s.waitForURL(/\/cases\/[0-9a-f-]{36}$/)
  const caseUrl = s.url()
  ok(true, 'staff created matter "Blair, Gary M. -- Guardianship"')

  // ---- First GL-A1 ----
  await s.locator('label.chip', { hasText: 'Real Estate' }).click()
  await s.fill('#nl-label', '3453 Hoover Rd')
  await btn(s, 'Create list').click()
  await s.waitForURL(/\/l\/[0-9a-f-]{36}$/)
  const list1 = s.url()
  const id1 = listIdFromUrl(list1)
  ok(await s.locator('#f-m_f01').inputValue() === 'Blair, Gary M. -- Guardianship', 'matter box filled from the matter')
  ok(await s.locator('#f-m_f07').inputValue() === '09/01/2026', 'valuation date carried into the matter box')

  // Six fields.
  await s.fill('#f-s01_f01', '3453 Hoover Rd')
  await s.fill('#f-s01_f02', 'Grove City, OH 43123')
  await s.locator('#f-s01_f02').blur()
  await s.getByRole('group', { name: 'Property type' }).locator('label', { hasText: 'Single-family' }).click()
  await s.getByRole('group', { name: "How it's titled" }).locator('label', { hasText: 'Sole name' }).click()
  await s.locator('section.first label', { hasText: 'Secure the property' }).click()
  await s.getByLabel('Electric Provider').fill('AEP Ohio')
  await s.getByLabel('Electric Provider').blur()
  await saved(s)
  await shot(s, '10-list-filled')
  ok(true, 'six fields entered and the page says Saved')

  // Close the tab, reopen the URL in a fresh tab.
  await s.close()
  const s2 = await S.newPage()
  s2.on('dialog', (d) => d.accept())
  await s2.goto(list1)
  ok(await s2.locator('#f-s01_f01').inputValue() === '3453 Hoover Rd', 'reopened: street address')
  ok(await s2.locator('#f-s01_f02').inputValue() === 'Grove City, OH 43123', 'reopened: city')
  ok(await s2.getByRole('group', { name: 'Property type' }).locator('label', { hasText: 'Single-family' }).locator('input').isChecked(), 'reopened: property type')
  ok(await s2.getByRole('group', { name: "How it's titled" }).locator('label', { hasText: 'Sole name' }).locator('input').isChecked(), 'reopened: titled')
  ok(await s2.locator('section.first label', { hasText: 'Secure the property' }).locator('input').isChecked(), 'reopened: do-first task')
  ok(await s2.getByLabel('Electric Provider').inputValue() === 'AEP Ohio', 'reopened: utilities table cell')

  // Nav clicks keep the session (regression for the re-login bug).
  await s2.locator('nav').getByRole('link', { name: 'Matters', exact: true }).click()
  await s2.waitForURL(BASE + '/')
  await s2.getByRole('link', { name: 'Blair, Gary M. -- Guardianship' }).click()
  await s2.waitForURL(caseUrl)
  await s2.getByRole('link', { name: '3453 Hoover Rd' }).click()
  await s2.waitForURL(list1)
  ok(true, 'clicking Matters, the matter, and the list keeps you signed in')

  // ---- Second GL-A1, no bleed-through ----
  await s2.goto(caseUrl)
  await s2.locator('label.chip', { hasText: 'Real Estate' }).click()
  await s2.fill('#nl-label', '12 Elm St')
  await btn(s2, 'Create list').click()
  await s2.waitForURL(/\/l\/[0-9a-f-]{36}$/)
  const list2 = s2.url()
  const id2 = listIdFromUrl(list2)
  ok(id1 !== id2, 'second list has its own URL')
  ok(await s2.locator('#f-s01_f01').inputValue() === '', 'second list starts empty')
  await s2.fill('#f-s01_f01', '12 Elm St')
  await s2.locator('#f-s01_f01').blur()
  await saved(s2)
  ok(sql(`select data->>'s01_f01' from public.instances where id = '${id1}'`) === '3453 Hoover Rd', 'first list unchanged by the second')

  // ---- Insurance No -> Yes shows in history ----
  await s2.goto(list1)
  const insured = s2.getByRole('group', { name: 'Named insured is the estate / guardianship' })
  await insured.locator('label.chip').filter({ hasText: exact('No') }).click()
  await saved(s2)
  await insured.locator('label.chip').filter({ hasText: exact('Yes') }).click()
  await saved(s2)
  await btn(s2, 'History').click()
  const hist = s2.locator('.hist', { hasText: 'Named insured is the estate / guardianship' }).first()
  await hist.waitFor()
  const histText = await hist.innerText()
  ok(/No\s*->\s*Yes/.test(histText) && /Sam Staff/.test(histText) && /\d{1,2}:\d{2}/.test(histText),
    'history shows No -> Yes with name and time')
  ok((await s2.locator('.hist button', { hasText: 'Revert' }).count()) === 0, 'staff sees no Revert')
  await btn(s2, 'Close').click()
  ok((await btn(s2, 'Delete this list').count()) === 0, 'staff sees no Delete')

  // ---- Copy for BusinessMap ----
  await btn(s2, 'Copy for BusinessMap').click()
  const summary = await s2.locator('.panel.open textarea').inputValue()
  ok(summary.startsWith('GL-A1 REAL ESTATE CHECKLIST'), 'summary header')
  ok(summary.includes('-- Matter --') && summary.includes('Matter / case name: Blair, Gary M. -- Guardianship'), 'summary matter block')
  ok(summary.includes('Street address: 3453 Hoover Rd'), 'summary text field')
  ok(summary.includes('Electric -- Provider: AEP Ohio'), 'summary table cell')
  ok(summary.includes('  [x] Secure the property'), 'summary do-first task')
  ok(summary.includes('Named insured is the estate / guardianship: Yes'), 'summary choice')
  await btn(s2, 'Close').click()

  // ---- Print: same page count as the reference HTML ----
  const blockFonts = (p) => p.route(/\.(woff2?|ttf)(\?|$)|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  const pp = await S.newPage()
  await blockFonts(pp)
  await pp.goto(list1)
  await pp.waitForFunction(() => document.body.classList.contains('print-one'))
  await pp.emulateMedia({ media: 'print' })
  const ourPages = pdfPages(await pp.pdf({ preferCSSPageSize: true, printBackground: true }))
  const ref = await browser.newPage()
  await blockFonts(ref)
  await ref.goto('file://' + process.cwd() + '/reference/Gasper_Legal_Asset_Intake_Checklists.html')
  await ref.evaluate(() => {
    document.querySelector('[data-go="re"]').click()
    document.body.classList.add('print-one')
  })
  const refPages = pdfPages(await ref.pdf({ preferCSSPageSize: true, printBackground: true }))
  console.log(`      print pages: ours ${ourPages}, reference ${refPages} (same fallback fonts)`)
  ok(ourPages === refPages, `printing GL-A1 gives the same page count as the reference (${ourPages})`)
  await pp.close()
  await ref.close()

  // ---- Logged-out browser lands on login, then back on the exact form ----
  const L = await browser.newContext()
  const l = await L.newPage()
  await l.goto(list1)
  ok(new URL(l.url()).pathname === '/login', 'logged-out list URL goes to login')
  await l.fill('#email', STAFF)
  await l.fill('#password', PW)
  await l.click('button[type=submit]')
  await l.waitForURL(list1)
  ok(await l.locator('#f-s01_f01').inputValue() === '3453 Hoover Rd', 'after sign-in, back on that exact filled form')
  await L.close()

  // ---- Two editors at once ----
  const A = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const a = await A.newPage()
  a.on('dialog', (d) => d.accept())
  await login(a, ATTY, new URL(list1).pathname)
  await a.waitForURL(list1)
  await s2.goto(list1)
  await Promise.all([
    (async () => {
      await s2.fill('#f-s01_f04', 'PARCEL-010-123456')
      await s2.locator('#f-s01_f04').blur()
    })(),
    (async () => {
      await a.fill('#f-s01_f03', 'Franklin')
      await a.locator('#f-s01_f03').blur()
    })(),
  ])
  await saved(s2)
  await saved(a)
  ok(sql(`select data->>'s01_f04' || '|' || (data->>'s01_f03') from public.instances where id = '${id1}'`) === 'PARCEL-010-123456|Franklin',
    'two people editing different fields: both saved')
  await s2.locator('#f-s01_f03').waitFor()
  await s2.waitForFunction(() => document.querySelector('#f-s01_f03')?.value === 'Franklin', null, { timeout: 25000 })
  ok(true, "the other person's change appears without reloading")

  // ---- Attorney: revert and delete ----
  await a.reload()
  await btn(a, 'History').click()
  const yesEntry = a.locator('.hist', { hasText: 'Named insured is the estate / guardianship' }).first()
  await yesEntry.getByRole('button', { name: 'Revert' }).click()
  await until(() => sql(`select data->>'s04_f11' from public.instances where id = '${id1}'`) === 'opt2', 'revert lands')
  ok(sql(`select data->>'s04_f11' from public.instances where id = '${id1}'`) === 'opt2', 'attorney reverted Yes back to No')
  ok(sql(`select count(*) from public.revisions r join public.profiles p on p.id = r.changed_by where r.instance_id = '${id1}' and r.field_key = 's04_f11' and p.email = '${ATTY}'`) === '1',
    'the revert is itself in the history, under the attorney')
  await btn(a, 'Close').click()

  await a.goto(list2)
  await btn(a, 'Delete this list').click()
  await a.waitForURL(caseUrl)
  ok((await a.getByRole('link', { name: '12 Elm St' }).count()) === 0, 'deleted list is gone from the matter')
  ok(sql(`select count(*) from public.delete_log d join public.profiles p on p.id = d.actor where d.entity_id = '${id2}' and d.action = 'delete' and p.email = '${ATTY}'`) === '1',
    'deletion logged with who and when')
  await s2.goto(list2)
  ok((await s2.locator('text=We could not find that').count()) === 1, 'staff opening the deleted list URL gets nothing')

  // ---- GL-A6 totals ----
  await s2.goto(caseUrl)
  await s2.locator('label.chip', { hasText: 'Monthly Budget' }).click()
  await s2.fill('#nl-label', 'Budget 2026')
  await btn(s2, 'Create list').click()
  await s2.waitForURL(/\/l\/[0-9a-f-]{36}$/)
  const fill = async (label, v) => {
    await s2.getByLabel(label, { exact: true }).fill(v)
    await s2.getByLabel(label, { exact: true }).blur()
  }
  await fill('Social Security Net $', '1,500.00')
  await fill('Pension Net $', '250')
  await fill('Rent Monthly $', '$1,200')
  await fill('Electric Monthly $', '150')
  await s2.locator('label', { hasText: 'Medicaid personal needs allowance' }).click()
  ok(await s2.getByLabel('Personal spending allowance Monthly $', { exact: true }).inputValue() === '75', '$75 personal needs allowance filled in')
  const val = (l) => s2.getByLabel(l, { exact: true }).inputValue()
  ok(await val('Total monthly net income') === '$1,750.00', 'income total')
  ok(await val('Total monthly expenses') === '$1,425.00', 'expenses total (1200 + 150 + 75)')
  ok(await val('Monthly surplus or shortfall') === '$325.00', 'surplus')
  await fill('Facility / assisted living Monthly $', '900')
  ok(await val('Monthly surplus or shortfall') === '-$575.00', 'shortfall goes negative')
  await saved(s2)
  await shot(s2, '11-budget')

  // ---- Phone width ----
  const M = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  const m = await M.newPage()
  await login(m, STAFF, new URL(list1).pathname)
  await m.waitForURL(list1)
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(overflow <= 0, 'list page has no sideways scroll at 390px')
  await shot(m, '12-list-mobile')

  await browser.close()
  console.log(`\n${passed} list checks passed.`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
