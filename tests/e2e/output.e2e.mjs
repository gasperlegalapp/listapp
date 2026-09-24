// End-to-end checks for milestones 5 and 6: PDF download, photos, checklist
// versions and the delete log. Same environment as lists.e2e.mjs, plus a
// Supabase Storage API behind SUPABASE_URL (the photo checks upload to it).
// Publishes a new GL-A1 version on every run, so point it at a throwaway
// database only, never production.
//
//   APP_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... E2E_DATABASE_URL=... \
//   node tests/e2e/output.e2e.mjs

import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

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
  sql(`update public.profiles set role = '${role}', full_name = '${name}' where email = '${email}'`)
  return sql(`select id from auth.users where email = '${email}'`)
}
const btn = (page, name) => page.getByRole('button', { name, exact: true })
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

const STAFF = `out-staff-${RUN}@example.com`
const ATTY = `out-atty-${RUN}@example.com`
const ADMIN = `out-admin-${RUN}@example.com`

try {
  const staffId = await createUser(STAFF, 'Sam Output', 'staff')
  await createUser(ATTY, 'Alex Output', 'attorney')
  await createUser(ADMIN, 'Ada Output', 'admin')

  const browser = await chromium.launch()
  async function signIn(email, opts = { viewport: { width: 1200, height: 900 } }) {
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true })
    const page = await ctx.newPage()
    page.on('dialog', (d) => d.accept())
    await page.goto(`${BASE}/login`)
    await page.fill('#email', email)
    await page.fill('#password', PW)
    await page.click('button[type=submit]')
    await page.waitForURL(BASE + '/')
    return page
  }

  // A matter with an empty GL-A1 and a GL-A6, made directly in the database.
  const caseId = sql(
    `insert into cases (name, matter_type, created_by) values ('Output ${RUN} -- Estate', 'estate', '${staffId}') returning id`,
  ).split('\n')[0]
  const latest = (code) => sql(`select id || ' ' || version from templates where code = '${code}' order by version desc limit 1`).split(' ')
  const newList = (code, label, data = {}) => {
    const [tid, v] = latest(code)
    return sql(
      `insert into instances (case_id, template_id, template_version, label, data, created_by) values ('${caseId}', '${tid}', ${v}, '${label}', '${JSON.stringify(data)}'::jsonb, '${staffId}') returning id`,
    ).split('\n')[0]
  }
  const house = newList('GL-A1', '3453 Hoover Rd')
  const budget = newList('GL-A6', 'Budget', { s02_t1_r1_c2: '2,500.00', s02_t1_r2_c2: '1200', s03_t1_r1_c1: '4000' })

  // ---- PDF ----
  const s = await signIn(STAFF)
  const r1 = await s.request.get(`${BASE}/l/${house}/pdf`)
  const pdf1 = await r1.body()
  ok(r1.status() === 200 && r1.headers()['content-type'] === 'application/pdf', 'PDF route returns a PDF')
  ok(
    /^attachment; filename="GL-A1_3453-Hoover-Rd_\d{4}-\d{2}-\d{2}\.pdf"$/.test(r1.headers()['content-disposition']),
    `PDF is named code_label_date (${r1.headers()['content-disposition']})`,
  )
  ok(pdfPages(pdf1) === 6, `blank GL-A1 PDF is six letter pages like the printout (${pdfPages(pdf1)})`)
  const r6 = await s.request.get(`${BASE}/l/${budget}/pdf`)
  ok(r6.status() === 200 && pdfPages(await r6.body()) >= 5, 'GL-A6 PDF renders')

  // Typing then downloading at once: the PDF waits for the save.
  await s.goto(`${BASE}/l/${house}`)
  await s.fill('#f-s01_f01', '3453 Hoover Rd')
  const [dl] = await Promise.all([s.waitForEvent('download'), btn(s, 'Download PDF').click()])
  ok(/^GL-A1_3453-Hoover-Rd_\d{4}-\d{2}-\d{2}\.pdf$/.test(dl.suggestedFilename()), `Download PDF saves ${dl.suggestedFilename()}`)
  ok(sql(`select data->>'s01_f01' from instances where id = '${house}'`) === '3453 Hoover Rd', 'unsaved typing was saved before the PDF was made')

  const anon = await (await browser.newContext()).newPage()
  await anon.goto(`${BASE}/l/${house}/pdf`)
  ok(new URL(anon.url()).pathname === '/login', 'signed-out PDF request lands on login')

  // ---- Photos ----
  await s.locator('.photos').scrollIntoViewIfNeeded()
  const jpeg = await s.screenshot({ type: 'jpeg' })
  await s.locator('.photohead input[type=file]').setInputFiles([
    { name: 'front porch.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
  ])
  await s.locator('.photogrid li').first().waitFor({ timeout: 20000 })
  await s.locator('.upl .err').waitFor()
  ok((await s.locator('.photogrid li').count()) === 1, 'photo uploaded and shown on the list')
  ok((await s.locator('.upl .err').textContent()).includes('Only photos'), 'a text file is refused with a reason')
  await s.waitForFunction(() => {
    const i = document.querySelector('.photogrid img')
    return i && i.complete && i.naturalWidth > 0
  })
  ok(true, 'thumbnail loads through the signed redirect')
  const att = sql(`select id || ' ' || mime_type || ' ' || size_bytes from attachments where instance_id = '${house}'`).split(' ')
  ok(att[1] === 'image/jpeg' && Number(att[2]) === jpeg.length, 'stored type and size come from Storage, not the browser')
  const f = await s.request.get(`${BASE}/files/${att[0]}`, { maxRedirects: 0 })
  ok(f.status() === 302 && f.headers()['location'].includes('/storage/v1/object/sign/attachments/'), '/files/<id> redirects to a signed URL')
  const fd = await s.request.get(`${BASE}/files/${att[0]}?download=1`)
  ok((fd.headers()['content-disposition'] || '').includes('front porch.jpg'), 'download keeps the file name')
  ok((await s.locator('.photogrid button', { hasText: 'Delete' }).count()) === 0, 'staff cannot delete a photo')
  const anonFile = await anon.request.get(`${BASE}/files/${att[0]}`, { maxRedirects: 0 })
  ok([302, 307, 401].includes(anonFile.status()) && !(anonFile.headers()['location'] || '').includes('/storage/'), 'signed-out users get no photo URL')
  await s.setViewportSize(devices['iPhone 13'].viewport)
  await s.locator('.photos').screenshot({ path: `${OUT}/60-photos-phone.png` })
  ok(!(await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'photos fit a 390px phone screen')

  const a = await signIn(ATTY)
  await a.goto(`${BASE}/l/${house}`)
  await a.locator('.photogrid button', { hasText: 'Delete' }).click()
  await a.locator('.photogrid li').waitFor({ state: 'detached' })
  ok(sql(`select action || ' ' || label from delete_log where entity_id = '${att[0]}'`) === 'delete front porch.jpg', 'attorney deleted the photo and it is logged')
  ok((await a.request.get(`${BASE}/files/${att[0]}`, { maxRedirects: 0 })).status() === 404, 'a deleted photo is no longer served')

  // ---- Delete log ----
  const st = await s.request.get(`${BASE}/admin/deleted`, { maxRedirects: 0 })
  ok(st.status() >= 300 && st.status() < 400, 'staff are turned away from the delete log')
  await a.goto(`${BASE}/l/${budget}`)
  await btn(a, 'Delete this list').click()
  await a.waitForURL(/\/cases\//)
  await a.goto(`${BASE}/cases/${caseId}`)
  await a.goto(`${BASE}/l/${house}`)
  await btn(a, 'Delete this list').click()
  await a.waitForURL(/\/cases\//)
  await btn(a, 'Delete matter').click()
  await a.waitForURL(BASE + '/')
  await a.goto(`${BASE}/admin/deleted`)
  const top = await a.locator('tbody tr').first().textContent()
  ok(top.includes('Matter') && top.includes(`Output ${RUN}`) && top.includes('Alex Output'), 'delete log shows the matter, who and when')
  const budgetRow = a.locator('tbody tr', { hasText: 'Budget' }).first()
  await budgetRow.getByRole('button', { name: 'Restore' }).click()
  await budgetRow.locator('.formerr').waitFor()
  ok((await budgetRow.locator('.formerr').textContent()).includes('matter first'), 'a list cannot come back before its matter')
  await a.locator('tbody tr', { hasText: `Output ${RUN}` }).first().getByRole('button', { name: 'Restore' }).click()
  await a.locator('tbody tr').first().filter({ hasText: 'Restored' }).waitFor()
  await a.locator('tbody tr', { hasText: 'Budget' }).first().getByRole('button', { name: 'Restore' }).click()
  await a.locator('tbody tr').first().filter({ hasText: 'Budget' }).waitFor()
  ok(sql(`select deleted_at is null from instances where id = '${budget}'`) === 't', 'matter restored, then its list')
  await a.goto(`${BASE}/l/${budget}`)
  ok((await a.locator('#f-s12_f01').inputValue()) === '$3,700.00', 'restored list opens with its data')
  await a.goto(`${BASE}/admin/deleted`)
  await a.screenshot({ path: `${OUT}/61-delete-log.png`, fullPage: true })

  // ---- Checklist versions ----
  ok((await a.request.get(`${BASE}/admin/templates`, { maxRedirects: 0 })).status() >= 300, 'attorneys cannot open checklist versions')
  const ad = await signIn(ADMIN)
  const oldVersion = Number(latest('GL-A1')[1])
  const oldList = newList('GL-A1', `Version ${oldVersion} house`, { s01_f01: '12 Elm St' })
  const ref = readFileSync(join(import.meta.dirname, '..', '..', 'reference', 'Gasper_Legal_Asset_Intake_Checklists.html'), 'utf8')
  const label = `Street address (${RUN})`
  const edited = ref
    .replace("{f:'Street address',w:4}", `{f:'${label}',w:4}`)
    .replace('bring them to the attorney. In an estate', `bring them to the attorney (test ${RUN}). In an estate`)
  const file = join(os.tmpdir(), `checklists-${RUN}.html`)
  writeFileSync(file, edited)

  await ad.goto(`${BASE}/admin/templates`)
  await ad.locator('#tpl-file').setInputFiles({ name: 'broken.html', mimeType: 'text/html', buffer: Buffer.from(ref.replace('const SHEETS=[', 'const SHEETS=[ oops(')) })
  await ad.locator('.formerr').waitFor()
  ok((await ad.locator('.formerr').textContent()).includes('error'), 'a broken checklist file is refused with the script error')
  await ad.locator('#tpl-file').setInputFiles(file)
  await ad.locator('.pubitem').first().waitFor()
  const heads = await ad.locator('.pubitem h4').allTextContents()
  ok(heads[0].includes(`v${oldVersion} to v${oldVersion + 1}`) && heads.slice(1).every((h) => h.includes('No changes')), 'only GL-A1 shows as changed')
  const diff = await ad.locator('.pubitem').first().locator('.diff').textContent()
  ok(diff.includes(`+ Field: ${label}`) && diff.includes('+ WARNING: Never tell an occupant'), 'the diff shows the new label and the changed warning')
  const publish = btn(ad, `Publish GL-A1 v${oldVersion + 1}`)
  ok(await publish.isDisabled(), 'a changed standing warning must be confirmed before publishing')
  await ad.locator('.pubitem label.chip').first().click()
  await publish.click()
  await ad.locator('.pubitem .formmsg').waitFor()
  ok(Number(latest('GL-A1')[1]) === oldVersion + 1, `GL-A1 version ${oldVersion + 1} published`)
  await ad.screenshot({ path: `${OUT}/62-published.png`, fullPage: true })

  await ad.goto(`${BASE}/l/${oldList}`)
  ok(
    (await ad.locator('label[for=f-s01_f01]').textContent()) !== label && (await ad.locator('#f-s01_f01').inputValue()) === '12 Elm St',
    'a list made on the old version still renders that version, data intact',
  )
  await ad.goto(`${BASE}/cases/${caseId}`)
  await ad.locator('label.chip', { hasText: 'Real Estate' }).click()
  await ad.fill('#nl-label', 'New version house')
  await btn(ad, 'Create list').click()
  await ad.waitForURL(/\/l\/[0-9a-f-]{36}$/)
  ok((await ad.locator('label[for=f-s01_f01]').textContent()) === label, 'a new list uses the new version')
  await ad.fill('#f-s01_f01', '99 Oak Ave')
  await ad.locator('#f-s01_f01').blur()
  await ad.locator('.savestate.saved').waitFor({ timeout: 15000 })
  ok(true, 'the new version saves')

  await ad.goto(`${BASE}/admin/templates`)
  await ad.locator('#tpl-file').setInputFiles(file)
  await ad.locator('.pubitem').first().waitFor()
  ok((await ad.locator('.pubitem h4').first().textContent()).includes('No changes'), 'uploading the same file again shows no changes')

  await browser.close()
  console.log(`\n${passed} checks passed.`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
