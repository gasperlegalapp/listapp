import type { TemplateSchema } from './types'
import { computeTotals } from './budget'
import { blocks, cellKey, type Value, type Values } from './values'

// Ported from the reference HTML's summarize(): "Label: value" lines grouped
// by section, answered fields only, in page order. ASCII dashes stand in for
// the original's em dashes.
export function summarize(schema: TemplateSchema, values: Values): string {
  const totals = computeTotals(schema, values)
  const optLabels = (opts: { key: string; label: string }[], v: Value | undefined) => {
    const picked = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
    return opts.filter((o) => picked.includes(o.key)).map((o) => o.label)
  }
  const out = [`${schema.code} ${schema.title.toUpperCase()} CHECKLIST`]
  for (const b of blocks(schema)) {
    const lines: string[] = []
    for (const r of b.rows) {
      switch (r.type) {
        case 'text':
        case 'textarea': {
          const v = values[r.key]
          if (typeof v === 'string' && v.trim()) lines.push(`${r.label}: ${v.trim()}`)
          break
        }
        case 'computed': {
          const v = totals.auto[r.auto]
          if (v) lines.push(`${r.label}: ${v}`)
          break
        }
        case 'choice':
        case 'tasks': {
          const picked = optLabels(r.options, values[r.key])
          if (!picked.length) break
          if (b.first) lines.push(picked.map((x) => '  [x] ' + x).join('\n'))
          else lines.push(`${r.label}: ${picked.join(', ')}`)
          break
        }
        case 'table':
          r.rows.forEach((rowLabel, ri) =>
            r.cols.slice(1).forEach((col, ci) => {
              const v = values[cellKey(r.key, ri + 1, ci + 1)]
              if (typeof v === 'string' && v.trim()) lines.push(`${rowLabel} -- ${col}: ${v.trim()}`)
            }),
          )
          break
      }
    }
    if (lines.length) out.push('', `-- ${b.name} --`, ...lines)
  }
  return out.length > 1 ? out.join('\n') : 'Nothing has been filled in on this sheet yet. Answer a few fields, then try again.'
}
