// Template schema as stored in templates.schema (jsonb).
//
// Field keys are positional and stable within a template version:
//   m_f01           matter header, field 1
//   first           the red "Do these first" task list
//   s03_f02         section 3, input field 2 (static rows do not consume numbers)
//   s03_f02 = "opt1" option 1 of that choice field (fully qualified: s03_f02_opt1)
//   s06_t1_r2_c1    section 6, table 1, row 2, first input column
//   w_f01           wrap-up (sign-off) block, field 1
// Labels are display only. Rewording a label never changes a key.

export type AccentToken = 'ok' | 'slate' | 'gold' | 'stamp' | 'teal' | 'plum'

export type ChoiceOption = {
  key: string // "opt1"
  label: string
  // GL-A6: picking this option fills a blank cell with a value.
  autofill?: { target: string; value: string }
}

export type TextRow = { type: 'text'; key: string; label: string; w: number; hint?: string }
export type TextareaRow = { type: 'textarea'; key: string; label: string; rows: number; hint?: string }
export type ChoiceRow = {
  type: 'choice'
  key: string
  label: string
  w: number
  multi: boolean
  options: ChoiceOption[]
  hint?: string
}
export type TasksRow = { type: 'tasks'; key: string; label: string; options: ChoiceOption[] }
export type TableKind = 'inc' | 'exp' | 'ded' | 'one'
export type TableRow = {
  type: 'table'
  key: string // s06_t1; cells are `${key}_r${row}_c${col}`, both 1-based
  cols: string[] // cols[0] heads the row-label column; cols[1..] are inputs c1..
  rows: string[]
  sum?: number // input column index (1-based, = cols index) that totals
  kind?: TableKind
  totLabel?: string
}
export type ComputedRow = {
  type: 'computed'
  key: string // never stored
  label: string
  w: number
  auto: 'income' | 'expenses' | 'diff'
}
export type SubheadRow = { type: 'subhead'; text: string }
export type NoteRow = { type: 'tip' | 'warn'; html: string } // only <b> tags allowed
export type ExplainRow = { type: 'explain'; items: [string, string][] }
export type SettledRow = { type: 'settled'; text: string }

export type Row =
  | TextRow
  | TextareaRow
  | ChoiceRow
  | TasksRow
  | TableRow
  | ComputedRow
  | SubheadRow
  | NoteRow
  | ExplainRow
  | SettledRow

export type Section = { key: string; n: number; title: string; rows: Row[] }

// What a stored value must look like, keyed by field key. Checked in Postgres
// by set_instance_field() so a buggy client cannot write junk.
export type KeySpec = { t: 'text' } | { t: 'one'; n: number } | { t: 'many'; n: number }

export type TemplateSchema = {
  format: 1
  code: string // GL-A1
  slug: string // re
  title: string // Real Estate
  sub: string
  accent: AccentToken
  matter: Row[]
  first: TasksRow
  sections: Section[]
  signoff: Row[]
  keys: Record<string, KeySpec>
}
