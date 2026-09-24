import { requireUser } from '@/lib/auth'

type TemplateCard = { code: string; name: string; version: number; accent: string; sub: string }

export default async function HomePage() {
  const { supabase } = await requireUser()
  const { data } = await supabase
    .from('templates')
    .select('code, name, version, accent, sub:schema->>sub')
    .order('code')
    .order('version', { ascending: false })
    .returns<TemplateCard[]>()

  // Newest version of each checklist.
  const latest = new Map<string, TemplateCard>()
  for (const t of data ?? []) if (!latest.has(t.code)) latest.set(t.code, t)

  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Staff field checklists - Guardianship and probate</div>
        <h2>Matters</h2>
        <p className="sub">Matters and their lists arrive in the next milestone.</p>
      </div>

      <h3 className="eyebrow" style={{ marginTop: 34 }}>
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
    </>
  )
}
