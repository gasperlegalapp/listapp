// Template conversion, validation and change outline. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { RENDER_MARKER, convertSheets, type SheetSource } from '../../lib/templates/convert'
import { diffLines, outline, warningsChanged } from '../../lib/templates/outline'
import type { TemplateSchema } from '../../lib/templates/types'
import { checkTemplate, sameTemplate } from '../../lib/templates/validate'

const ROOT = join(__dirname, '..', '..')
const CODES = ['GL-A1', 'GL-A2', 'GL-A3', 'GL-A4', 'GL-A5', 'GL-A6']
const v1 = (code: string) => JSON.parse(readFileSync(join(ROOT, 'templates', `${code}.v1.json`), 'utf8')) as TemplateSchema
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

// Postgres jsonb reorders object keys; reverse them all to simulate that.
function reorder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reorder)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)]))
  return v
}

function loadReference(): SheetSource {
  const html = readFileSync(join(ROOT, 'reference', 'Gasper_Legal_Asset_Intake_Checklists.html'), 'utf8')
  const code = html.match(/<script>([\s\S]*?)<\/script>/)![1]
  return vm.runInNewContext(code.slice(0, code.indexOf(RENDER_MARKER)) + '\n;({SHEETS, MATTER, SIGNOFF})', Object.create(null))
}

test('converting the reference file reproduces the seeded version 1 templates', () => {
  const out = convertSheets(clone(loadReference())) // plain objects, not the vm's
  assert.deepEqual(out.map((t) => t.code), CODES)
  for (const t of out) assert.deepEqual(clone(t), v1(t.code))
})

for (const code of CODES) {
  test(`${code} v1 passes the publish check unchanged`, () => {
    const r = checkTemplate(v1(code))
    assert.ok(r.ok, r.ok ? '' : r.error)
    assert.deepEqual(clone(r.schema), v1(code))
    assert.ok(sameTemplate(v1(code), reorder(v1(code)) as TemplateSchema))
  })
}

const bad = (mutate: (s: TemplateSchema) => void, expect: RegExp) => {
  const s = v1('GL-A1')
  mutate(s)
  const r = checkTemplate(s)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, expect)
}

test('refuses a field whose key is not its position', () =>
  bad((s) => {
    const rows = s.sections[0].rows as { key?: string }[]
    const [a, b] = rows.filter((r) => r.key)
    ;[a.key, b.key] = [b.key, a.key]
  }, /field key should be s01_f01/))
test('refuses non-ASCII text', () => bad((s) => (s.sections[0].title = 'Property \u2014 id'), /plain ASCII/))
test('refuses markup other than <b> in notes', () =>
  bad((s) => s.sections[0].rows.push({ type: 'warn', html: '<img src=x onerror=alert(1)>' }), /<b> tags and nothing else/))
test('refuses moving a matter field the matter record fills', () =>
  bad((s) => (s.matter[3] = { type: 'text', key: 'm_f04', label: 'Matter type', w: 3 }), /filled from the matter record/))
test('refuses unknown row types', () => bad((s) => s.sections[0].rows.push({ type: 'html', html: 'x' } as never), /unknown row type/))
test('refuses an autofill that points nowhere', () => {
  const s = v1('GL-A6')
  const choice = s.sections.flatMap((x) => x.rows).find((r) => r.type === 'choice' && r.options.some((o) => o.autofill))
  if (choice?.type !== 'choice') throw new Error('fixture')
  choice.options.find((o) => o.autofill)!.autofill!.target = 's99_t1_r1_c1'
  const r = checkTemplate(s)
  assert.equal(r.ok, false)
})
test('ignores a keys map sent by the browser and derives its own', () => {
  const s = v1('GL-A2')
  s.keys = { evil: { t: 'text' } }
  const r = checkTemplate(s)
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(clone(r.schema.keys), v1('GL-A2').keys)
})
test('drops properties it does not know', () => {
  const s = v1('GL-A3') as TemplateSchema & { extra?: string }
  s.extra = 'x'
  ;(s.sections[0] as unknown as Record<string, unknown>).script = 'x'
  const r = checkTemplate(s)
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(clone(r.schema), v1('GL-A3'))
})

test('the outline flags a changed standing warning, and only that', () => {
  const a = v1('GL-A1')
  const relabel = clone(a)
  const field = relabel.sections[0].rows.find((r) => r.type === 'text')!
  if (field.type === 'text') field.label = 'Street address (as on the deed)'
  const d1 = diffLines(outline(a), outline(relabel))
  assert.equal(d1.filter((x) => x.op !== ' ').length, 2)
  assert.equal(warningsChanged(d1), false)
  assert.equal(sameTemplate(a, relabel), false)

  const soften = clone(a)
  const warn = soften.sections.flatMap((s) => s.rows).find((r) => r.type === 'warn' && r.html.includes('estate or the guardianship'))
  assert.ok(warn, 'fixture: the insurance warning exists')
  if (warn?.type === 'warn') warn.html = warn.html.replace('always the estate or the guardianship', 'usually the estate')
  assert.equal(warningsChanged(diffLines(outline(a), outline(soften))), true)
})
