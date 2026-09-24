import { requireUser } from '@/lib/auth'
import { ActionForm } from '@/components/action-form'
import { CaseFields } from '@/components/case-fields'
import { MatterTable, type MatterRow } from '@/components/matter-table'
import { matterTypeLabel } from '@/lib/templates/matter'
import { createCase } from './cases/actions'

type TemplateCard = { code: string; name: string; version: number; accent: string; sub: string }
type CaseRow = {
  id: string
  name: string
  case_number: string | null
  county: string | null
  matter_type: string
  status: string
  instances: { count: number }[]
}

export default async function HomePage() {
  const { supabase } = await requireUser()
  const [{ data: cases }, { data: templates }] = await Promise.all([
    supabase
      .from('cases')
      .select('id, name, case_number, county, matter_type, status, instances(count)')
      .is('deleted_at', null)
      .is('instances.deleted_at', null)
      .order('name')
      .returns<CaseRow[]>(),
    supabase
      .from('templates')
      .select('code, name, version, accent, sub:schema->>sub')
      .order('code')
      .order('version', { ascending: false })
      .returns<TemplateCard[]>(),
  ])

  const toRow = (c: CaseRow): MatterRow => ({
    id: c.id,
    name: c.name,
    case_number: c.case_number,
    county: c.county,
    type: matterTypeLabel(c.matter_type),
    lists: c.instances?.[0]?.count ?? 0,
  })
  const open = (cases ?? []).filter((c) => c.status === 'open').map(toRow)
  const closed = (cases ?? []).filter((c) => c.status === 'closed').map(toRow)

  const latest = new Map<string, TemplateCard>()
  for (const t of templates ?? []) if (!latest.has(t.code)) latest.set(t.code, t)

  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Staff field checklists - Guardianship and probate</div>
        <h2>Matters</h2>
        <p className="sub">Open a matter to see its lists, or start a new one.</p>
      </div>

      <details className="newbox">
        <summary className="btn primary">New matter</summary>
        <section className="matter">
          <div className="ttl">New matter</div>
          <ActionForm action={createCase}>
            <CaseFields />
            <p style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit">
                Create matter
              </button>
            </p>
          </ActionForm>
        </section>
      </details>

      <MatterTable rows={open} />

      {closed.length ? (
        <details style={{ marginTop: 22 }}>
          <summary className="eyebrow" style={{ cursor: 'pointer' }}>
            Closed matters ({closed.length})
          </summary>
          <MatterTable rows={closed} />
        </details>
      ) : null}

      <h3 className="eyebrow" style={{ marginTop: 40 }}>
        The six checklists
      </h3>
      <div className="index" style={{ marginTop: 12 }}>
        {[...latest.values()].map((t) => (
          <div key={t.code} className="idx" style={{ '--c': `var(--${t.accent})` } as React.CSSProperties}>
            <span className="mono">
              {t.code} v{t.version}
            </span>
            <h3>{t.name}</h3>
            <p>{t.sub}</p>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        To fill one in, open a matter and choose New list.
      </p>
    </>
  )
}
