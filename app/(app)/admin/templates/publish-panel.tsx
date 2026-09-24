'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RENDER_MARKER, convertSheets, type SheetSource } from '@/lib/templates/convert'
import { WARNING, diffLines, hunks, outline, warningsChanged, type DiffLine } from '@/lib/templates/outline'
import type { TemplateSchema } from '@/lib/templates/types'
import { checkTemplate, sameTemplate } from '@/lib/templates/validate'
import { publishTemplate } from './actions'

type Current = Record<string, { version: number; schema: TemplateSchema }>
type Candidate = {
  schema: TemplateSchema
  status: 'new' | 'same' | 'changed' | 'invalid'
  from: number // the version it would replace as current
  diff: DiffLine[]
  warnings: boolean
  problem?: string
}

// Run the data part of the uploaded file's script in a sandboxed iframe (its
// own opaque origin: no access to this page, its cookies or the app) and hand
// back plain data. The render code after RENDER_MARKER is never run.
function readSheets(html: string): Promise<SheetSource> {
  const m = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) return Promise.reject(new Error('That file has no checklist script in it.'))
  const cut = m[1].indexOf(RENDER_MARKER)
  if (cut < 0) return Promise.reject(new Error('That file is not laid out like the checklist file (render marker not found).'))
  const nonce = crypto.randomUUID()
  const post = (body: string) => `parent.postMessage({ nonce: ${JSON.stringify(nonce)}, ${body} }, '*')`
  const doc =
    '<!doctype html><meta charset="utf-8">' +
    `<script>window.onerror = function (m) { ${post('error: String(m)')} }</script>` +
    `<script>${m[1].slice(0, cut)}\n;${post('data: JSON.parse(JSON.stringify({ SHEETS: SHEETS, MATTER: MATTER, SIGNOFF: SIGNOFF }))')}</script>`

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.style.display = 'none'
    const finish = (fn: () => void) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      frame.remove()
      fn()
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.nonce !== nonce) return
      if (e.data.error) finish(() => reject(new Error(`The checklist script has an error: ${e.data.error}`)))
      else finish(() => resolve(e.data.data as SheetSource))
    }
    const timer = setTimeout(() => finish(() => reject(new Error('We could not read the checklist data from that file.'))), 5000)
    window.addEventListener('message', onMessage)
    frame.srcdoc = doc
    document.body.appendChild(frame)
  })
}

export function PublishPanel({ current }: { current: Current }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const load = async (file: File) => {
    setError(null)
    setCandidates([])
    setResults({})
    setConfirmed({})
    setFileName(file.name)
    try {
      const schemas = convertSheets(await readSheets(await file.text()))
      setCandidates(
        schemas.map((schema): Candidate => {
          const cur = current[schema.code]
          if (!cur) return { schema, status: 'new', from: 0, diff: [], warnings: false }
          const diff = diffLines(outline(cur.schema), outline(schema))
          const base = { schema, from: cur.version, diff, warnings: warningsChanged(diff) }
          if (sameTemplate(cur.schema, schema)) return { ...base, status: 'same' }
          // The same check the server runs, so problems show before publishing.
          const checked = checkTemplate(schema)
          return checked.ok ? { ...base, status: 'changed' } : { ...base, status: 'invalid', problem: checked.error }
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not read that file.')
    }
  }

  const publish = async (c: Candidate) => {
    setBusy(c.schema.code)
    try {
      const res = await publishTemplate(JSON.stringify(c.schema), !!confirmed[c.schema.code])
      setResults((r) => ({ ...r, [c.schema.code]: { ok: !res.error, text: res.error ?? res.message ?? '' } }))
      if (!res.error) router.refresh()
    } catch {
      setResults((r) => ({ ...r, [c.schema.code]: { ok: false, text: 'We could not reach the server. Try again.' } }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="fld" style={{ '--w': 6, marginTop: 8 } as React.CSSProperties}>
        <label htmlFor="tpl-file">Checklist file (.html)</label>
        <input
          id="tpl-file"
          type="file"
          accept=".html,.htm,text/html"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void load(f)
          }}
        />
      </div>
      {error ? (
        <p className="formerr" role="alert">
          {error}
        </p>
      ) : null}

      {candidates.length ? (
        <p className="tblnote" style={{ marginTop: 12 }}>
          {fileName}: {candidates.filter((c) => c.status === 'changed').length} of {candidates.length} checklists changed.
        </p>
      ) : null}

      {candidates.map((c) => {
        const res = results[c.schema.code]
        return (
          <div key={c.schema.code} className="pubitem" style={{ '--accent': `var(--${c.schema.accent})` } as React.CSSProperties}>
            <h4>
              <span className="mono">{c.schema.code}</span> {c.schema.title}{' '}
              {c.status === 'same' ? (
                <span className="pill ok">No changes</span>
              ) : c.status === 'new' ? (
                <span className="pill stamp">Not one of our checklists</span>
              ) : c.status === 'invalid' ? (
                <span className="pill stamp">Cannot publish</span>
              ) : (
                <span className="pill gold">
                  Changed: v{c.from} to v{c.from + 1}
                </span>
              )}
            </h4>
            {c.status === 'new' ? (
              <p className="tblnote">This page revises existing checklists only; adding a new checklist is a code change.</p>
            ) : null}
            {c.status === 'invalid' ? (
              <p className="formerr" role="alert">
                {c.problem}
              </p>
            ) : null}
            {c.status === 'changed' || c.status === 'invalid' ? (
              <>
                <div className="diff" role="region" aria-label={`Changes to ${c.schema.code}`}>
                  {hunks(c.diff).map((d, i) =>
                    d === null ? (
                      <div key={i} className="gap">
                        ...
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={`${d.op === '+' ? 'add' : d.op === '-' ? 'del' : ''}${d.text.startsWith(WARNING) ? ' warn' : ''}`}
                      >
                        {d.op} {d.text}
                      </div>
                    ),
                  )}
                  {!c.diff.some((d) => d.op !== ' ') ? (
                    <div className="gap">Only behind-the-scenes details changed (for example which box an option fills).</div>
                  ) : null}
                </div>
                {c.warnings ? (
                  <label className="chip task" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!confirmed[c.schema.code]}
                      onChange={(e) => setConfirmed((x) => ({ ...x, [c.schema.code]: e.target.checked }))}
                    />
                    <span className="box"></span>A standing warning changed. We have read it and it is not weakened.
                  </label>
                ) : null}
                <p style={{ marginTop: 10 }}>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy !== null || c.status !== 'changed' || !!res?.ok || (c.warnings && !confirmed[c.schema.code])}
                    onClick={() => void publish(c)}
                  >
                    {busy === c.schema.code ? 'Publishing...' : `Publish ${c.schema.code} v${c.from + 1}`}
                  </button>
                </p>
              </>
            ) : null}
            {res ? (
              <p className={res.ok ? 'formmsg' : 'formerr'} role={res.ok ? 'status' : 'alert'}>
                {res.text}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
