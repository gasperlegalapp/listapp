import type { ChoiceRow, TemplateSchema } from './types'
import type { Values } from './values'

// The "Status" choice in each checklist's control section (Not started ...
// Settled). Found by shape, not position, so it survives template revisions.
export function statusField(schema: TemplateSchema): ChoiceRow | undefined {
  for (const s of schema.sections)
    for (const r of s.rows)
      if (r.type === 'choice' && !r.multi && r.label === 'Status' && r.options.some((o) => o.label === 'Settled')) return r
  return undefined
}

export function statusLabel(schema: TemplateSchema, values: Values): string | null {
  const f = statusField(schema)
  if (!f) return null
  const v = values[f.key]
  return f.options.find((o) => o.key === v)?.label ?? 'Not started'
}
