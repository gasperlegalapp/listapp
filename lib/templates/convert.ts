// Converts the firm's checklist HTML data (the SHEETS, MATTER and SIGNOFF
// arrays in its inline script) into template schemas with positional keys.
// Pure and dependency-free: used by scripts/import-templates.ts (Node) and by
// the admin Checklists page (browser), so both produce identical templates.

import type { AccentToken, ChoiceOption, KeySpec, Row, Section, TableKind, TasksRow, TemplateSchema } from './types'

export type SheetSource = { SHEETS: Src[]; MATTER: Src[]; SIGNOFF: Src[] }
type Src = Record<string, unknown>

// Where the data part of the HTML's script ends and the rendering code begins.
export const RENDER_MARKER = '/* ---------- render ---------- */'

// ---------- ASCII normalization (firm convention: ASCII only) ----------
const ASCII_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2013': '-',
  '\u2014': '--',
  '\u2212': '-',
  '\u00b7': '-',
  '\u00a0': ' ',
}
export function ascii(s: string): string {
  const out = s.replace(/[^\x00-\x7F]/g, (ch) => {
    const r = ASCII_MAP[ch]
    if (r === undefined) throw new Error(`No ASCII mapping for U+${ch.codePointAt(0)!.toString(16)} in: ${s}`)
    return r
  })
  return out
}
// Guidance notes may carry <b> tags and nothing else.
function noteHtml(s: string): string {
  const t = ascii(s)
  const stripped = t.replace(/<\/?b>/g, '')
  if (/[<>]/.test(stripped)) throw new Error(`Unexpected markup in note: ${t}`)
  return t
}

// ---------- convert ----------
const pad = (n: number) => String(n).padStart(2, '0')
const opts = (o: unknown[]): ChoiceOption[] =>
  o.map((label, i) => ({ key: `opt${i + 1}`, label: ascii(String(label)) }))

class Numberer {
  f = 0
  t = 0
  constructor(readonly prefix: string) {}
  field() {
    this.f++
    return `${this.prefix}_f${pad(this.f)}`
  }
  table() {
    this.t++
    return `${this.prefix}_t${this.t}`
  }
}

function convertRow(r: Src, num: Numberer, keys: Record<string, KeySpec>): Row {
  const w = typeof r.w === 'number' ? r.w : 3
  const hint = typeof r.h === 'string' ? ascii(r.h) : undefined
  if (typeof r.s === 'string') return { type: 'subhead', text: ascii(r.s) }
  if (typeof r.tip === 'string') return { type: 'tip', html: noteHtml(r.tip) }
  if (typeof r.warn === 'string') return { type: 'warn', html: noteHtml(r.warn) }
  if (Array.isArray(r.x))
    return { type: 'explain', items: (r.x as string[][]).map(([b, p]) => [ascii(b), ascii(p)] as [string, string]) }
  if (typeof r.settled === 'string') return { type: 'settled', text: ascii(r.settled) }
  if (Array.isArray(r.k)) {
    const key = num.field()
    const options = opts(r.k)
    keys[key] = { t: 'many', n: options.length }
    return { type: 'tasks', key, label: ascii(String(r.kl ?? 'Steps done')), options }
  }
  if (r.t && typeof r.t === 'object') {
    const T = r.t as { cols: string[]; rows: string[]; sum?: number; kind?: string; totLabel?: string }
    const key = num.table()
    T.rows.forEach((_, ri) =>
      T.cols.slice(1).forEach((_, ci) => {
        keys[`${key}_r${ri + 1}_c${ci + 1}`] = { t: 'text' }
      }),
    )
    return {
      type: 'table',
      key,
      cols: T.cols.map(ascii),
      rows: T.rows.map(ascii),
      ...(T.sum != null ? { sum: T.sum } : {}),
      ...(T.kind ? { kind: T.kind as TableKind } : {}),
      ...(T.totLabel ? { totLabel: ascii(T.totLabel) } : {}),
    }
  }
  if (typeof r.f === 'string') {
    const key = num.field()
    if (typeof r.auto === 'string')
      return { type: 'computed', key, label: ascii(r.f), w, auto: r.auto as 'income' | 'expenses' | 'diff' }
    keys[key] = { t: 'text' }
    return { type: 'text', key, label: ascii(r.f), w, ...(hint ? { hint } : {}) }
  }
  if (typeof r.a === 'string') {
    const key = num.field()
    keys[key] = { t: 'text' }
    return { type: 'textarea', key, label: ascii(r.a), rows: typeof r.r === 'number' ? r.r : 2, ...(hint ? { hint } : {}) }
  }
  if (typeof r.c === 'string' && Array.isArray(r.o)) {
    const key = num.field()
    const multi = !!r.m
    const options = opts(r.o)
    keys[key] = multi ? { t: 'many', n: options.length } : { t: 'one', n: options.length }
    return { type: 'choice', key, label: ascii(r.c), w, multi, options, ...(hint ? { hint } : {}) }
  }
  throw new Error(`Unrecognized row: ${JSON.stringify(r)}`)
}

// GL-A6: the HTML fills "Personal spending allowance -- Monthly $" with 75
// when the Medicaid personal needs allowance option is picked. It finds both by
// label; we resolve them to positional keys once, here.
function wireMedicaidAutofill(sections: Section[]) {
  for (const sec of sections) {
    const choice = sec.rows.find(
      (r) => r.type === 'choice' && r.options.some((o) => o.label.startsWith('Medicaid personal needs')),
    )
    if (!choice || choice.type !== 'choice') continue
    const table = sec.rows.find((r) => r.type === 'table' && r.rows.includes('Personal spending allowance'))
    if (!table || table.type !== 'table') throw new Error('Personal spending allowance row not found')
    const ri = table.rows.indexOf('Personal spending allowance') + 1
    const ci = table.cols.indexOf('Monthly $')
    if (ci < 1) throw new Error('Monthly $ column not found')
    const opt = choice.options.find((o) => o.label.startsWith('Medicaid personal needs'))!
    opt.autofill = { target: `${table.key}_r${ri}_c${ci}`, value: '75' }
    return
  }
  throw new Error('Medicaid personal needs option not found in GL-A6')
}

export function convertSheet(s: Src, MATTER: Src[], SIGNOFF: Src[]): TemplateSchema {
  const keys: Record<string, KeySpec> = {}
  const matterNum = new Numberer('m')
  const matter = MATTER.map((r) => convertRow(r, matterNum, keys))
  const firstOptions = opts(s.first as string[])
  const first: TasksRow = { type: 'tasks', key: 'first', label: 'Do first (done)', options: firstOptions }
  keys.first = { t: 'many', n: firstOptions.length }
  const sections: Section[] = (s.secs as Src[]).map((sec, i) => {
    const key = `s${pad(i + 1)}`
    const num = new Numberer(key)
    return { key, n: i + 1, title: ascii(String(sec.t)), rows: (sec.rows as Src[]).map((r) => convertRow(r, num, keys)) }
  })
  const signNum = new Numberer('w')
  const signoff = SIGNOFF.map((r) => convertRow(r, signNum, keys))
  const code = String(s.code)
  if (code === 'GL-A6') wireMedicaidAutofill(sections)
  return {
    format: 1,
    code,
    slug: String(s.id),
    title: ascii(String(s.title)),
    sub: ascii(String(s.sub)),
    accent: String(s.accent).replace(/^--/, '') as AccentToken,
    matter,
    first,
    sections,
    signoff,
    keys,
  }
}

export function convertSheets(src: SheetSource): TemplateSchema[] {
  if (!Array.isArray(src?.SHEETS) || !Array.isArray(src?.MATTER) || !Array.isArray(src?.SIGNOFF))
    throw new Error('The file does not have the SHEETS, MATTER and SIGNOFF data this app expects.')
  return src.SHEETS.map((s) => convertSheet(s, src.MATTER, src.SIGNOFF))
}
