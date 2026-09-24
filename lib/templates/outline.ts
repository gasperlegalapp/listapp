// A plain-text outline of a checklist, one line per thing a person sees, and
// a line diff between two outlines. The admin Checklists page shows this so a
// new version can be checked before it is published. Warning lines are
// marked so a changed standing warning cannot slip through unnoticed.

import type { Row, TemplateSchema } from './types'

const plain = (html: string) => html.replace(/<\/?b>/g, '')
export const WARNING = 'WARNING: '

function rowLines(r: Row): string[] {
  switch (r.type) {
    case 'subhead':
      return [`-- ${r.text} --`]
    case 'tip':
      return [`Tip: ${plain(r.html)}`]
    case 'warn':
      return [WARNING + plain(r.html)]
    case 'explain':
      return r.items.map(([b, t]) => `Explainer: ${b}: ${t}`)
    case 'settled':
      return [`Settled box: ${r.text}`]
    case 'tasks':
      return [`Steps: ${r.label}`, ...r.options.map((o) => `  [ ] ${o.label}`)]
    case 'table':
      return [
        `Table: ${r.cols.join(' | ')}${r.sum != null ? ` (totals column ${r.sum}${r.kind ? `, ${r.kind}` : ''})` : ''}`,
        ...r.rows.map((x) => `  row: ${x}`),
        ...(r.totLabel ? [`  total: ${r.totLabel}`] : []),
      ]
    case 'computed':
      return [`Computed: ${r.label} (${r.auto})`]
    case 'text':
      return [`Field: ${r.label}${r.hint ? ` -- hint: ${r.hint}` : ''}`]
    case 'textarea':
      return [`Notes (${r.rows} lines): ${r.label}${r.hint ? ` -- hint: ${r.hint}` : ''}`]
    case 'choice':
      return [
        `${r.multi ? 'Check all' : 'Pick one'}: ${r.label}: ${r.options
          .map((o) => o.label + (o.autofill ? ` (fills ${o.autofill.value})` : ''))
          .join(' / ')}${r.hint ? ` -- hint: ${r.hint}` : ''}`,
      ]
  }
}

export function outline(s: TemplateSchema): string[] {
  return [
    `${s.code} ${s.title} Checklist`,
    `Subtitle: ${s.sub}`,
    `Colour: ${s.accent}`,
    '== Matter ==',
    ...s.matter.flatMap(rowLines),
    '== Do these first ==',
    ...s.first.options.map((o) => `  [ ] ${o.label}`),
    ...s.sections.flatMap((sec) => [`== ${String(sec.n).padStart(2, '0')} ${sec.title} ==`, ...sec.rows.flatMap(rowLines)]),
    '== Wrap-up ==',
    ...s.signoff.flatMap(rowLines),
  ]
}

export type DiffLine = { op: ' ' | '+' | '-'; text: string }

// Longest-common-subsequence line diff. Outlines are a few hundred lines, so
// the quadratic table is small.
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i] })
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: a[i++] })
    else out.push({ op: '+', text: b[j++] })
  }
  while (i < n) out.push({ op: '-', text: a[i++] })
  while (j < m) out.push({ op: '+', text: b[j++] })
  return out
}

// Only the changed lines, with a little context and section headings kept so
// each change can be placed.
export function hunks(d: DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = new Set<number>()
  d.forEach((x, i) => {
    if (x.op !== ' ') for (let k = i - context; k <= i + context; k++) keep.add(k)
  })
  const out: (DiffLine | null)[] = []
  let last = -2
  let heading: DiffLine | null = null
  d.forEach((x, i) => {
    if (x.op === ' ' && x.text.startsWith('== ')) heading = x
    if (!keep.has(i)) return
    if (i !== last + 1) {
      out.push(null)
      if (heading && heading !== x) out.push(heading)
    }
    out.push(x)
    last = i
  })
  return out
}

export const warningsChanged = (d: DiffLine[]) => d.some((x) => x.op !== ' ' && x.text.startsWith(WARNING))
