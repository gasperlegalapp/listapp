import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { fmtWhen } from '@/lib/format'
import { ActionForm } from '@/components/action-form'
import { CaseFields } from '@/components/case-fields'
import { CASE_COLUMNS, fmtDate, matterTypeLabel, ourRoleLabel, type CaseRecord } from '@/lib/templates/matter'
import { statusLabel } from '@/lib/templates/status'
import type { TemplateSchema } from '@/lib/templates/types'
import type { Values } from '@/lib/templates/values'
import { createInstance, deleteCase, updateCase } from '../actions'

type Inst = { id: string; label: string; template_id: string; data: Values; updated_at: string; updated_by: string | null }
type Tpl = { id: string; code: string; name: string; accent: string; version: number; schema: TemplateSchema }

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { supabase, profile } = await requireUser()

  const { data: c } = await supabase.from('cases').select(CASE_COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle<CaseRecord>()
  if (!c) notFound()

  const [{ data: insts }, { data: latest }] = await Promise.all([
    supabase
      .from('instances')
      .select('id, label, template_id, data, updated_at, updated_by')
      .eq('case_id', id)
      .is('deleted_at', null)
      .order('created_at')
      .returns<Inst[]>(),
    supabase.from('templates').select('code, name, accent, version').order('code').order('version', { ascending: false }),
  ])

  const tplIds = [...new Set((insts ?? []).map((i) => i.template_id))]
  const userIds = [...new Set((insts ?? []).map((i) => i.updated_by).filter(Boolean))] as string[]
  const [{ data: tpls }, { data: people }] = await Promise.all([
    tplIds.length
      ? supabase.from('templates').select('id, code, name, accent, version, schema').in('id', tplIds).returns<Tpl[]>()
      : Promise.resolve({ data: [] as Tpl[] }),
    userIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ])
  const tplById = new Map((tpls ?? []).map((t) => [t.id, t]))
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]))

  const checklists: { code: string; name: string; accent: string }[] = []
  for (const t of latest ?? []) if (!checklists.some((x) => x.code === t.code)) checklists.push(t)

  const groups = checklists
    .map((ck) => ({
      ...ck,
      items: (insts ?? []).filter((i) => tplById.get(i.template_id)?.code === ck.code),
    }))
    .filter((g) => g.items.length)

  const facts = [
    c.case_number && `Case no. ${c.case_number}`,
    c.county && `${c.county} County`,
    c.court,
    c.ward_or_decedent && `Ward / decedent: ${c.ward_or_decedent}`,
    c.valuation_date && `Valuation date ${fmtDate(c.valuation_date)}`,
    c.our_role && `Our role: ${ourRoleLabel(c.our_role)}`,
  ].filter(Boolean)

  return (
    <>
      <p className="crumbs noprint">
        <Link href="/">Matters</Link>
      </p>
      <div className="pagehead">
        <div className="eyebrow">
          {matterTypeLabel(c.matter_type)}
          {c.status === 'closed' ? ' - Closed' : ''}
        </div>
        <h2>{c.name}</h2>
        {facts.length ? <p className="sub">{facts.join(' - ')}</p> : null}
      </div>

      <section className="matter" style={{ marginTop: 0 }}>
        <div className="ttl">New list</div>
        <ActionForm action={createInstance}>
          <input type="hidden" name="case_id" value={c.id} />
          <div className="grid">
            <div className="fld" style={{ '--w': 6 } as React.CSSProperties} role="group" aria-label="Checklist">
              <span className="lbl">Which checklist</span>
              <div className="chips">
                {checklists.map((ck) => (
                  <label key={ck.code} className="chip round">
                    <input type="radio" name="code" value={ck.code} required />
                    <span className="box"></span>
                    <span className="mono" style={{ fontSize: 11, color: `var(--${ck.accent})` }}>
                      {ck.code}
                    </span>
                    {ck.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="fld" style={{ '--w': 4 } as React.CSSProperties}>
              <label htmlFor="nl-label">Name for this list</label>
              <input type="text" id="nl-label" name="label" required maxLength={200} />
              <div className="hint">What tells it apart: an address, a vehicle, a bank and last 4. One list per asset.</div>
            </div>
            <div className="fld" style={{ '--w': 2, alignSelf: 'end' } as React.CSSProperties}>
              <button className="btn primary" type="submit">
                Create list
              </button>
            </div>
          </div>
        </ActionForm>
      </section>

      {groups.length === 0 ? (
        <p className="sub" style={{ marginTop: 24 }}>
          No lists yet. Create the first one above.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.code} className="listgroup" style={{ '--accent': `var(--${g.accent})` } as React.CSSProperties}>
            <h3>
              <span className="mono">{g.code}</span> {g.name}
            </h3>
            <ul>
              {g.items.map((i) => {
                const t = tplById.get(i.template_id)!
                const status = statusLabel(t.schema, i.data)
                const by = i.updated_by ? nameById.get(i.updated_by) : null
                return (
                  <li key={i.id}>
                    <Link href={`/l/${i.id}`}>{i.label}</Link>
                    {status ? <span className={`pill ${status === 'Settled' ? 'ok' : 'gold'}`}>{status}</span> : null}
                    <span className="meta">
                      Updated {fmtWhen(i.updated_at)}
                      {by ? ` by ${by}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      <details className="newbox" style={{ marginTop: 34 }}>
        <summary className="btn quiet">Edit matter details</summary>
        <section className="matter">
          <div className="ttl">Matter details</div>
          <ActionForm action={updateCase}>
            <input type="hidden" name="id" value={c.id} />
            <CaseFields c={c} />
            <div className="grid" style={{ marginTop: 10 }}>
              <div className="fld" style={{ '--w': 6 } as React.CSSProperties} role="group" aria-label="Matter status">
                <span className="lbl">Matter status</span>
                <div className="chips">
                  <label className="chip round">
                    <input type="radio" name="status" value="open" defaultChecked={c.status === 'open'} />
                    <span className="box"></span>Open
                  </label>
                  <label className="chip round">
                    <input type="radio" name="status" value="closed" defaultChecked={c.status === 'closed'} />
                    <span className="box"></span>Closed
                  </label>
                </div>
              </div>
            </div>
            <p style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit">
                Save matter
              </button>
            </p>
          </ActionForm>
        </section>
      </details>

      {profile.role !== 'staff' ? (
        <ActionForm action={deleteCase} confirm={`Delete the matter "${c.name}"? It is kept in the delete log.`}>
          <input type="hidden" name="id" value={c.id} />
          <p style={{ marginTop: 16 }}>
            <button className="btn quiet" type="submit">
              Delete matter
            </button>
          </p>
        </ActionForm>
      ) : null}
    </>
  )
}
