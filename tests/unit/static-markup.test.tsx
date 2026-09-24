// The PDF's static renderer must produce exactly what React would, for every
// template, with awkward values. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sheet } from '../../components/checklist/sheet'
import { renderStatic } from '../../lib/pdf/static-markup'
import { computeTotals } from '../../lib/templates/budget'
import type { TemplateSchema } from '../../lib/templates/types'
import type { Values } from '../../lib/templates/values'

const dir = join(__dirname, '..', '..', 'templates')
const templates = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as TemplateSchema)

function sample(schema: TemplateSchema, seed: number): Values {
  const out: Values = {}
  let i = seed
  for (const [key, spec] of Object.entries(schema.keys)) {
    i++
    if (i % 3 === 0) continue
    if (spec.t === 'text') out[key] = i % 5 === 0 ? `\nline one <b>&amp; "q" 'a'\n${'x'.repeat(200)}` : `${i * 12.5} & <x>`
    else if (spec.t === 'one') out[key] = `opt${(i % spec.n) + 1}`
    else out[key] = Array.from({ length: spec.n }, (_, k) => `opt${k + 1}`).filter((_, k) => (k + i) % 2 === 0)
  }
  return out
}

test('there are templates to check', () => assert.ok(templates.length >= 6))

for (const schema of templates) {
  for (const seed of [0, 1]) {
    test(`${schema.code} static markup matches React (seed ${seed})`, () => {
      const shown = { ...sample(schema, seed), m_f01: 'Blair, Gary M. -- Guardianship' }
      const el = <Sheet schema={schema} shown={shown} totals={computeTotals(schema, shown)} />
      assert.equal(renderStatic(el), renderToStaticMarkup(el))
    })
  }
  test(`${schema.code} empty static markup matches React`, () => {
    const el = <Sheet schema={schema} shown={{}} totals={computeTotals(schema, {})} />
    assert.equal(renderStatic(el), renderToStaticMarkup(el))
  })
}
