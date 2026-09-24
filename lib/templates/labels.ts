import type { ChoiceOption, TemplateSchema } from './types'
import { blocks, cellKey } from './values'

// Human-readable names for positional keys, for the history panel.
export type KeyInfo = { section: string; label: string; options?: ChoiceOption[] }

export function keyIndex(schema: TemplateSchema): Map<string, KeyInfo> {
  const idx = new Map<string, KeyInfo>()
  idx.set('_label', { section: 'List', label: 'List name' })
  for (const b of blocks(schema)) {
    for (const r of b.rows) {
      if (r.type === 'text' || r.type === 'textarea' || r.type === 'computed') idx.set(r.key, { section: b.name, label: r.label })
      else if (r.type === 'choice' || r.type === 'tasks')
        idx.set(r.key, { section: b.name, label: b.first ? 'Do these first' : r.label, options: r.options })
      else if (r.type === 'table')
        r.rows.forEach((rowLabel, ri) =>
          r.cols.slice(1).forEach((col, ci) =>
            idx.set(cellKey(r.key, ri + 1, ci + 1), { section: b.name, label: `${rowLabel} -- ${col}` }),
          ),
        )
    }
  }
  return idx
}

export function formatStored(info: KeyInfo | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)'
  if (info?.options) {
    const picked = Array.isArray(v) ? v : [v]
    const labels = info.options.filter((o) => picked.includes(o.key)).map((o) => o.label)
    return labels.length ? labels.join(', ') : '(blank)'
  }
  return String(v)
}
