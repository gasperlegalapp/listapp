import type { Row, Section, TemplateSchema } from './types'

// Stored answer: text/textarea/table cell -> string; single choice -> "optN";
// multi choice and task lists -> ["optN", ...]. Unanswered keys are absent.
export type Value = string | string[]
export type Values = Record<string, Value>

// The blocks of a sheet in page order, as the reference HTML renders them.
export type Block = { name: string; rows: Row[]; first?: boolean }

export function blocks(schema: TemplateSchema): Block[] {
  return [
    { name: 'Matter', rows: schema.matter },
    { name: 'Do first', rows: [schema.first], first: true },
    ...schema.sections.map((s: Section) => ({ name: s.title, rows: s.rows })),
    { name: 'Wrap-up', rows: schema.signoff },
  ]
}

export const cellKey = (tableKey: string, row: number, col: number) => `${tableKey}_r${row}_c${col}`

export function isAnswered(v: Value | undefined): v is Value {
  if (v === undefined) return false
  return Array.isArray(v) ? v.length > 0 : v.trim() !== ''
}
