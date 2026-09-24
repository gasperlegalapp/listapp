import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { fmtWhen } from '@/lib/format'
import { ActionForm } from '@/components/action-form'
import { restoreItem } from './actions'

type Entry = {
  id: number
  entity: 'case' | 'instance' | 'attachment'
  entity_id: string
  action: 'delete' | 'restore'
  label: string | null
  actor: string | null
  at: string
}

const PAGE = 100
const WHAT = { case: 'Matter', instance: 'List', attachment: 'Photo / document' } as const

// Who deleted or restored what, and when. The log is append-only; deleted
// matters, lists and photos can be restored from here.
export default async function DeleteLogPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { supabase } = await requireRole('admin', 'attorney')
  const before = Number((await searchParams).before)

  let q = supabase
    .from('delete_log')
    .select('id, entity, entity_id, action, label, actor, at')
    .order('id', { ascending: false })
    .limit(PAGE)
  if (Number.isInteger(before) && before > 0) q = q.lt('id', before)
  const { data } = await q.returns<Entry[]>()
  const log = data ?? []

  const ids = (e: Entry['entity']) => [...new Set(log.filter((x) => x.entity === e).map((x) => x.entity_id))]
  const [{ data: atts }, { data: people }] = await Promise.all([
    ids('attachment').length
      ? supabase.from('attachments').select('id, instance_id, deleted_at').in('id', ids('attachment'))
      : Promise.resolve({ data: [] as { id: string; instance_id: string; deleted_at: string | null }[] }),
    supabase.from('profiles').select('id, full_name, email'),
  ])
  const attById = new Map((atts ?? []).map((a) => [a.id, a]))
  const instIds = [...new Set([...ids('instance'), ...(atts ?? []).map((a) => a.instance_id)])]
  const { data: insts } = instIds.length
    ? await supabase.from('instances').select('id, case_id, label, template_id, deleted_at').in('id', instIds)
    : { data: [] as { id: string; case_id: string; label: string; template_id: string; deleted_at: string | null }[] }
  const instById = new Map((insts ?? []).map((i) => [i.id, i]))
  const caseIds = [...new Set([...ids('case'), ...(insts ?? []).map((i) => i.case_id)])]
  const tplIds = [...new Set((insts ?? []).map((i) => i.template_id))]
  const [{ data: cases }, { data: tpls }] = await Promise.all([
    caseIds.length
      ? supabase.from('cases').select('id, name, deleted_at').in('id', caseIds)
      : Promise.resolve({ data: [] as { id: string; name: string; deleted_at: string | null }[] }),
    tplIds.length
      ? supabase.from('templates').select('id, code').in('id', tplIds)
      : Promise.resolve({ data: [] as { id: string; code: string }[] }),
  ])
  const caseById = new Map((cases ?? []).map((c) => [c.id, c]))
  const codeById = new Map((tpls ?? []).map((t) => [t.id, t.code]))
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))

  // Only the newest entry for something still deleted gets a Restore button.
  const seen = new Set<string>()
  const rows = log.map((e) => {
    const key = `${e.entity}:${e.entity_id}`
    const newest = !seen.has(key)
    seen.add(key)
    const inst = e.entity === 'instance' ? instById.get(e.entity_id) : e.entity === 'attachment' ? instById.get(attById.get(e.entity_id)?.instance_id ?? '') : undefined
    const kase = e.entity === 'case' ? caseById.get(e.entity_id) : caseById.get(inst?.case_id ?? '')
    const current =
      e.entity === 'case' ? caseById.get(e.entity_id) : e.entity === 'instance' ? instById.get(e.entity_id) : attById.get(e.entity_id)
    const stillDeleted = !!current?.deleted_at
    const where =
      e.entity === 'attachment' && inst
        ? { text: `${inst.label}${kase ? ` - ${kase.name}` : ''}`, href: !inst.deleted_at ? `/l/${inst.id}` : null }
        : e.entity === 'instance' && kase
          ? { text: kase.name, href: !kase.deleted_at ? `/cases/${kase.id}` : null }
          : null
    const open =
      !stillDeleted && e.entity === 'case'
        ? `/cases/${e.entity_id}`
        : !stillDeleted && e.entity === 'instance'
          ? `/l/${e.entity_id}`
          : null
    return { e, newest, inst, stillDeleted, where, open }
  })

  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h2>Delete log</h2>
        <p className="sub">
          Who deleted or restored what, and when. Nothing is ever erased: a deleted matter, list or photo can be
          restored here. Restore a matter before its lists.
        </p>
      </div>

      {rows.length ? (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Name</th>
                <th>On</th>
                <th>By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, newest, inst, stillDeleted, where, open }) => (
                <tr key={e.id}>
                  <td className="cell">{fmtWhen(e.at)}</td>
                  <td className="cell">
                    {e.action === 'delete' ? <span className="pill stamp">Deleted</span> : <span className="pill ok">Restored</span>}{' '}
                    {WHAT[e.entity]}
                    {e.entity === 'instance' && inst ? <span className="mono"> {codeById.get(inst.template_id)}</span> : null}
                  </td>
                  <td className="cell">{open ? <Link href={open}>{e.label || '--'}</Link> : e.label || '--'}</td>
                  <td className="cell">{where ? where.href ? <Link href={where.href}>{where.text}</Link> : where.text : '--'}</td>
                  <td className="cell">{e.actor ? (who.get(e.actor) ?? 'Unknown') : 'System'}</td>
                  <td className="cell">
                    {newest && stillDeleted && e.action === 'delete' ? (
                      <ActionForm action={restoreItem} confirm={`Restore "${e.label ?? ''}"?`}>
                        <input type="hidden" name="entity" value={e.entity} />
                        <input type="hidden" name="id" value={e.entity_id} />
                        <button className="btn quiet" type="submit">
                          Restore
                        </button>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sub">Nothing has been deleted.</p>
      )}

      {log.length === PAGE ? (
        <p style={{ marginTop: 14 }}>
          <Link className="btn quiet" href={`/admin/deleted?before=${log[log.length - 1].id}`}>
            Older entries
          </Link>
        </p>
      ) : null}
    </>
  )
}
