// Strict check of a template schema before it is published as a new version.
// Runs on the server on whatever the browser sent. It rebuilds the schema
// from known properties only, re-derives every positional key and the keys
// map from the row order, and refuses anything it does not recognize, so what
// gets stored is exactly what was checked.

import type { ChoiceOption, KeySpec, Row, Section, TasksRow, TemplateSchema } from './types'

const ACCENTS = ['ok', 'slate', 'gold', 'stamp', 'teal', 'plum'] as const
const KINDS = ['inc', 'exp', 'ded', 'one'] as const
const AUTOS = ['income', 'expenses', 'diff'] as const
const pad = (n: number) => String(n).padStart(2, '0')

class Invalid extends Error {}
const fail = (where: string, what: string): never => {
  throw new Invalid(`${where}: ${what}`)
}

type Obj = Record<string, unknown>
const obj = (v: unknown, where: string): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : fail(where, 'expected an object')
const arr = (v: unknown, where: string, min: number, max: number): unknown[] => {
  if (!Array.isArray(v)) return fail(where, 'expected a list')
  if (v.length < min || v.length > max) fail(where, `expected ${min} to ${max} items, found ${v.length}`)
  return v
}
function text(v: unknown, where: string, max = 300, allowEmpty = false): string {
  if (typeof v !== 'string') return fail(where, 'expected text')
  if (!allowEmpty && !v.trim()) fail(where, 'is empty')
  if (v.length > max) fail(where, `is longer than ${max} characters`)
  if (!/^[\x20-\x7E]*$/.test(v)) fail(where, `must be plain ASCII on one line: "${v.slice(0, 60)}"`)
  return v
}
const int = (v: unknown, where: string, min: number, max: number): number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : fail(where, `expected a whole number ${min} to ${max}`)
function note(v: unknown, where: string): string {
  const s = text(v, where, 4000)
  if (/[<>]/.test(s.replace(/<\/?b>/g, ''))) fail(where, 'notes may contain <b> tags and nothing else')
  return s
}
const oneOf = <T extends string>(v: unknown, list: readonly T[], where: string): T =>
  list.includes(v as T) ? (v as T) : fail(where, `expected one of ${list.join(', ')}`)
const optional = <T>(o: Obj, k: string, f: (v: unknown) => T): { [key: string]: T } =>
  o[k] === undefined ? {} : { [k]: f(o[k]) }

class Keys {
  f = 0
  t = 0
  constructor(
    readonly prefix: string,
    readonly map: Record<string, KeySpec>,
  ) {}
  field(given: unknown, where: string) {
    const key = `${this.prefix}_f${pad(++this.f)}`
    if (given !== key) fail(where, `field key should be ${key}, found ${String(given)}`)
    return key
  }
  table(given: unknown, where: string) {
    const key = `${this.prefix}_t${++this.t}`
    if (given !== key) fail(where, `table key should be ${key}, found ${String(given)}`)
    return key
  }
}

function options(v: unknown, where: string): ChoiceOption[] {
  return arr(v, where, 1, 60).map((o, i) => {
    const x = obj(o, `${where} option ${i + 1}`)
    const key = `opt${i + 1}`
    if (x.key !== key) fail(where, `option ${i + 1} key should be ${key}`)
    const out: ChoiceOption = { key, label: text(x.label, `${where} option ${i + 1}`) }
    if (x.autofill !== undefined) {
      const a = obj(x.autofill, `${where} autofill`)
      out.autofill = { target: text(a.target, `${where} autofill target`, 64), value: text(a.value, `${where} autofill value`, 20) }
    }
    return out
  })
}

function row(v: unknown, where: string, keys: Keys): Row {
  const r = obj(v, where)
  const at = `${where} (${String(r.type)})`
  switch (r.type) {
    case 'subhead':
      return { type: 'subhead', text: text(r.text, at) }
    case 'tip':
    case 'warn':
      return { type: r.type, html: note(r.html, at) }
    case 'explain':
      return {
        type: 'explain',
        items: arr(r.items, at, 1, 12).map((it, i) => {
          const pair = arr(it, `${at} item ${i + 1}`, 2, 2)
          return [text(pair[0], at), text(pair[1], at, 2000)] as [string, string]
        }),
      }
    case 'settled':
      return { type: 'settled', text: text(r.text, at, 2000) }
    case 'tasks': {
      const key = keys.field(r.key, at)
      const opts = options(r.options, at)
      keys.map[key] = { t: 'many', n: opts.length }
      return { type: 'tasks', key, label: text(r.label, at), options: opts }
    }
    case 'table': {
      const key = keys.table(r.key, at)
      const cols = arr(r.cols, `${at} columns`, 2, 12).map((c) => text(c, `${at} column`, 120, true))
      const rows = arr(r.rows, `${at} rows`, 1, 80).map((c) => text(c, `${at} row`, 200, true))
      rows.forEach((_, ri) => cols.slice(1).forEach((_, ci) => (keys.map[`${key}_r${ri + 1}_c${ci + 1}`] = { t: 'text' })))
      return {
        type: 'table',
        key,
        cols,
        rows,
        ...optional(r, 'sum', (s) => int(s, `${at} sum column`, 1, cols.length - 1)),
        ...optional(r, 'kind', (k) => oneOf(k, KINDS, `${at} kind`)),
        ...optional(r, 'totLabel', (t) => text(t, `${at} total label`)),
      }
    }
    case 'computed':
      return {
        type: 'computed',
        key: keys.field(r.key, at),
        label: text(r.label, at),
        w: int(r.w, `${at} width`, 1, 6),
        auto: oneOf(r.auto, AUTOS, `${at} auto`),
      }
    case 'text': {
      const key = keys.field(r.key, at)
      keys.map[key] = { t: 'text' }
      return { type: 'text', key, label: text(r.label, at), w: int(r.w, `${at} width`, 1, 6), ...optional(r, 'hint', (h) => text(h, `${at} hint`, 600)) }
    }
    case 'textarea': {
      const key = keys.field(r.key, at)
      keys.map[key] = { t: 'text' }
      return { type: 'textarea', key, label: text(r.label, at), rows: int(r.rows, `${at} rows`, 1, 20), ...optional(r, 'hint', (h) => text(h, `${at} hint`, 600)) }
    }
    case 'choice': {
      const key = keys.field(r.key, at)
      if (typeof r.multi !== 'boolean') fail(at, 'multi must be true or false')
      const opts = options(r.options, at)
      keys.map[key] = r.multi ? { t: 'many', n: opts.length } : { t: 'one', n: opts.length }
      return {
        type: 'choice',
        key,
        label: text(r.label, at),
        w: int(r.w, `${at} width`, 1, 6),
        multi: r.multi as boolean,
        options: opts,
        ...optional(r, 'hint', (h) => text(h, `${at} hint`, 600)),
      }
    }
    default:
      return fail(where, `unknown row type ${String(r.type)}`)
  }
}

// The Matter box's first seven fields are filled from the matter record by
// position (lib/templates/matter.ts). A version that moved them would put the
// county in the case number box, so their shape is fixed.
const MATTER_SHAPE: [string, (r: Row) => boolean][] = [
  ['m_f01', (r) => r.type === 'text'],
  ['m_f02', (r) => r.type === 'text'],
  ['m_f03', (r) => r.type === 'text'],
  ['m_f04', (r) => r.type === 'choice' && !r.multi && r.options.length === 4],
  ['m_f05', (r) => r.type === 'choice' && !r.multi && r.options.length === 4],
  ['m_f06', (r) => r.type === 'text'],
  ['m_f07', (r) => r.type === 'text'],
]

export type Checked = { ok: true; schema: TemplateSchema } | { ok: false; error: string }

export function checkTemplate(input: unknown): Checked {
  try {
    const s = obj(input, 'template')
    if (s.format !== 1) fail('template', 'format must be 1')
    const code = text(s.code, 'code', 12)
    if (!/^GL-A[0-9]+$/.test(code)) fail('code', `must look like GL-A1, found ${code}`)
    const map: Record<string, KeySpec> = {}

    const mk = new Keys('m', map)
    const matter = arr(s.matter, 'Matter', 7, 40).map((r, i) => row(r, `Matter row ${i + 1}`, mk))
    for (const [key, ok] of MATTER_SHAPE) {
      const r = matter.find((x) => 'key' in x && x.key === key)
      if (!r || !ok(r))
        fail('Matter', `field ${key} is filled from the matter record and must keep its place and type (case name, case no., county, matter type, our role, ward, date)`)
    }

    const f = obj(s.first, 'Do these first')
    if (f.type !== 'tasks' || f.key !== 'first') fail('Do these first', 'must be the "first" task list')
    const firstOptions = options(f.options, 'Do these first')
    const first: TasksRow = { type: 'tasks', key: 'first', label: text(f.label, 'Do these first'), options: firstOptions }
    map.first = { t: 'many', n: firstOptions.length }

    const sections: Section[] = arr(s.sections, 'sections', 1, 40).map((v, i) => {
      const sec = obj(v, `section ${i + 1}`)
      const key = `s${pad(i + 1)}`
      if (sec.key !== key || sec.n !== i + 1) fail(`section ${i + 1}`, `should be ${key}, number ${i + 1}`)
      const title = text(sec.title, `section ${i + 1} title`)
      const sk = new Keys(key, map)
      return { key, n: i + 1, title, rows: arr(sec.rows, `section ${pad(i + 1)}`, 1, 400).map((r, j) => row(r, `${pad(i + 1)} ${title}, row ${j + 1}`, sk)) }
    })

    const wk = new Keys('w', map)
    const signoff = arr(s.signoff, 'Wrap-up', 1, 60).map((r, i) => row(r, `Wrap-up row ${i + 1}`, wk))

    // Autofill targets must be real text cells in this version.
    for (const r of [...matter, ...sections.flatMap((x) => x.rows), ...signoff])
      if ((r.type === 'choice' || r.type === 'tasks') && r.options.some((o) => o.autofill && map[o.autofill.target]?.t !== 'text'))
        fail(`"${r.label}"`, 'autofill points at a box that does not exist')

    const schema: TemplateSchema = {
      format: 1,
      code,
      slug: (() => {
        const v = text(s.slug, 'slug', 20)
        return /^[a-z0-9-]+$/.test(v) ? v : fail('slug', 'lowercase letters, digits and dashes only')
      })(),
      title: text(s.title, 'title', 80),
      sub: text(s.sub, 'subtitle', 600),
      accent: oneOf(s.accent, ACCENTS, 'accent'),
      matter,
      first,
      sections,
      signoff,
      keys: map,
    }
    return { ok: true, schema }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message }
    throw e
  }
}

// Same content, ignoring property order and anything checkTemplate drops.
export function sameTemplate(a: TemplateSchema, b: TemplateSchema) {
  const ca = checkTemplate(a)
  const cb = checkTemplate(b)
  return ca.ok && cb.ok && JSON.stringify(ca.schema) === JSON.stringify(cb.schema)
}
