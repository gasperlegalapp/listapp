import type { TableRow, TemplateSchema } from './types'
import { cellKey, type Values } from './values'

// Ported from the reference HTML's recalc(): table totals, and GL-A6's
// income / expenses / surplus-or-shortfall. Computed on render, never stored.

export const num = (v: string | undefined) => {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

export const fmtMoney = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type Totals = {
  tables: Record<string, string> // table key -> formatted total, '' when the column is empty
  auto: Record<'income' | 'expenses' | 'diff', string>
}

export function computeTotals(schema: TemplateSchema, values: Values): Totals {
  const tables: Record<string, string> = {}
  let inc = 0
  let exp = 0
  let any = false
  for (const sec of schema.sections) {
    for (const r of sec.rows) {
      if (r.type !== 'table' || r.sum == null) continue
      const t = r as TableRow
      let s = 0
      let has = false
      t.rows.forEach((_, ri) => {
        const v = values[cellKey(t.key, ri + 1, t.sum!)]
        if (typeof v === 'string' && v.trim()) {
          has = true
          s += num(v)
        }
      })
      tables[t.key] = has ? fmtMoney(s) : ''
      if (has && (t.kind === 'inc' || t.kind === 'exp')) any = true
      if (t.kind === 'inc') inc += s
      if (t.kind === 'exp') exp += s
    }
  }
  const f = (n: number) => (any ? fmtMoney(n) : '')
  return { tables, auto: { income: f(inc), expenses: f(exp), diff: f(inc - exp) } }
}
