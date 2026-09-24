// The Matter block at the top of every checklist is filled from the matter
// (case) record, so it is typed once and cannot disagree between lists.
// Keys are positional in the template's matter block; "Assigned staff"
// (m_f08) is the one matter field stored per list.

export type CaseRecord = {
  id: string
  name: string
  case_number: string | null
  county: string | null
  court: string | null
  matter_type: 'guardianship' | 'estate' | 'trust' | 'other'
  our_role: 'guardian_of_estate' | 'fiduciary_administrator' | 'counsel' | 'trustee' | null
  ward_or_decedent: string | null
  valuation_date: string | null
  status: 'open' | 'closed'
}

export const CASE_COLUMNS =
  'id, name, case_number, county, court, matter_type, our_role, ward_or_decedent, valuation_date, status'

// Order matches the template's option order for m_f04 and m_f05.
export const MATTER_TYPES = [
  ['guardianship', 'Guardianship'],
  ['estate', 'Estate'],
  ['trust', 'Trust'],
  ['other', 'Other'],
] as const
export const OUR_ROLES = [
  ['guardian_of_estate', 'Guardian of estate'],
  ['fiduciary_administrator', 'Fiduciary / administrator'],
  ['counsel', 'Counsel'],
  ['trustee', 'Trustee'],
] as const

export const matterTypeLabel = (v: string) => MATTER_TYPES.find(([k]) => k === v)?.[1] ?? v
export const ourRoleLabel = (v: string | null) => OUR_ROLES.find(([k]) => k === v)?.[1] ?? ''

const opt = (list: readonly (readonly [string, string])[], v: string | null) => {
  const i = list.findIndex(([k]) => k === v)
  return i < 0 ? undefined : `opt${i + 1}`
}

export function fmtDate(iso: string | null) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

export const MATTER_FROM_CASE = new Set(['m_f01', 'm_f02', 'm_f03', 'm_f04', 'm_f05', 'm_f06', 'm_f07'])

export function matterValues(c: CaseRecord): Record<string, string> {
  const out: Record<string, string | undefined> = {
    m_f01: c.name,
    m_f02: c.case_number ?? undefined,
    m_f03: c.county ?? undefined,
    m_f04: opt(MATTER_TYPES, c.matter_type),
    m_f05: opt(OUR_ROLES, c.our_role),
    m_f06: c.ward_or_decedent ?? undefined,
    m_f07: c.valuation_date ? fmtDate(c.valuation_date) : undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Record<string, string>
}
