import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { fmtWhen } from '@/lib/format'
import type { TemplateSchema } from '@/lib/templates/types'
import { PublishPanel } from './publish-panel'

type Version = {
  id: string
  code: string
  name: string
  version: number
  accent: string
  created_at: string
  created_by: string | null
  instances: { count: number }[]
}

// Checklist versions. A published version never changes; a revision is a new
// version, and only new lists use it.
export default async function TemplatesPage() {
  const { supabase } = await requireRole('admin')
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase
      .from('templates')
      .select('id, code, name, version, accent, created_at, created_by, instances(count)')
      .is('instances.deleted_at', null)
      .order('code')
      .order('version', { ascending: false })
      .returns<Version[]>(),
    supabase.from('profiles').select('id, full_name, email'),
  ])
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]))

  const codes = [...new Set((rows ?? []).map((r) => r.code))]
  const latestIds = codes.map((c) => (rows ?? []).find((r) => r.code === c)!.id)
  const { data: latest } = latestIds.length
    ? await supabase.from('templates').select('code, version, schema').in('id', latestIds)
    : { data: [] }
  const current = Object.fromEntries(
    (latest ?? []).map((t: { code: string; version: number; schema: TemplateSchema }) => [t.code, { version: t.version, schema: t.schema }]),
  )

  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h2>Checklists</h2>
        <p className="sub">
          Every version ever published, and how many lists use each. A published version never changes. New lists
          use the newest version; existing lists keep the one they were made with.
        </p>
      </div>

      {codes.map((code) => {
        const versions = (rows ?? []).filter((r) => r.code === code)
        return (
          <section key={code} className="listgroup" style={{ '--accent': `var(--${versions[0].accent})` } as React.CSSProperties}>
            <h3>
              <span className="mono">{code}</span> {versions[0].name}
            </h3>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Published</th>
                    <th>By</th>
                    <th>Lists</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v, i) => (
                    <tr key={v.id}>
                      <td>
                        v{v.version} {i === 0 ? <span className="pill ok">Current</span> : null}
                      </td>
                      <td className="cell">{fmtWhen(v.created_at)}</td>
                      <td className="cell">{v.created_by ? (who.get(v.created_by) ?? 'Unknown') : 'Initial import'}</td>
                      <td className="cell">{v.instances?.[0]?.count ?? 0}</td>
                      <td className="cell">
                        <Link href={`/admin/templates/${v.id}`}>View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section className="matter" style={{ marginTop: 34 }}>
        <div className="ttl">Publish a revision</div>
        <ol className="steps">
          <li>
            Edit the master checklist file (<span className="mono">Gasper_Legal_Asset_Intake_Checklists.html</span>):
            the <span className="mono">SHEETS</span>, <span className="mono">MATTER</span> and{' '}
            <span className="mono">SIGNOFF</span> data in its script. Keep the file you upload; the next change starts
            from it.
          </li>
          <li>Choose the file below. Nothing is saved yet: we show what changed in each checklist.</li>
          <li>Check the changes, then publish the checklists you mean to. Each becomes the next version.</li>
        </ol>
        <PublishPanel current={current} />
      </section>
    </>
  )
}
