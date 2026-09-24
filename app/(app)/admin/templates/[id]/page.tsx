import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { fmtWhen } from '@/lib/format'
import { computeTotals } from '@/lib/templates/budget'
import type { TemplateSchema } from '@/lib/templates/types'
import { Sheet } from '@/components/checklist/sheet'

// One published version, rendered blank, exactly as lists made with it look.
export default async function TemplateVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { supabase } = await requireRole('admin')
  const { data: t } = await supabase
    .from('templates')
    .select('code, version, created_at, schema')
    .eq('id', id)
    .maybeSingle<{ code: string; version: number; created_at: string; schema: TemplateSchema }>()
  if (!t) notFound()
  const { data: newer } = await supabase.from('templates').select('version').eq('code', t.code).gt('version', t.version).limit(1)

  return (
    <>
      <div className="crumbs noprint">
        <Link href="/admin/templates">Checklists</Link> / <b>{t.code} version {t.version}</b>
      </div>
      <p className="formmsg noprint" style={{ marginTop: 0 }}>
        {t.code} version {t.version}, published {fmtWhen(t.created_at)}.{' '}
        {newer?.length ? 'A newer version exists; lists made with this one still show it.' : 'This is the current version.'}
      </p>
      <Sheet schema={t.schema} shown={{}} totals={computeTotals(t.schema, {})} />
    </>
  )
}
