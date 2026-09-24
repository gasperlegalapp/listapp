'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionForm } from '@/components/action-form'
import { computeTotals } from '@/lib/templates/budget'
import { summarize } from '@/lib/templates/summary'
import type { ChoiceOption, TemplateSchema } from '@/lib/templates/types'
import type { Value, Values } from '@/lib/templates/values'
import { fmtTime } from '@/lib/format'
import {
  deleteInstance,
  loadHistory,
  pollInstance,
  renameInstance,
  revertField,
  type HistoryEntry,
} from '@/app/(app)/l/[id]/actions'
import { SaveQueue, type SaveStatus } from './save-queue'
import { HistoryPanel } from './history-panel'
import { Sheet } from './sheet'
import { Photos } from './photos'
import type { Attachment } from '@/lib/attachments'

type Props = {
  instanceId: string
  caseId: string
  caseName: string
  label: string
  data: Values
  schema: TemplateSchema
  matter: Record<string, string>
  attachments: Attachment[]
  canDelete: boolean
  canRevert: boolean
}

const TEXT_DELAY_MS = 1200 // save after this pause in typing; blur saves at once
const POLL_MS = 15000

const empty = (v: Value | null | undefined) => v == null || (Array.isArray(v) ? v.length === 0 : v === '')

export function ChecklistForm(p: Props) {
  const { schema, instanceId } = p
  const [values, setValues] = useState<Values>(p.data)
  const [label, setLabel] = useState(p.label)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const [panel, setPanel] = useState<null | 'summary' | 'history'>(null)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const [saver] = useState(() => new SaveQueue(p.instanceId, setStatus))
  const focused = useRef<string | null>(null)
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  const totals = useMemo(() => computeTotals(schema, values), [schema, values])
  const shown: Values = useMemo(() => ({ ...values, ...p.matter }), [values, p.matter])

  const setField = useCallback(
    (key: string, value: Value | null, delay: number) => {
      const v = empty(value) ? null : value
      setValues((prev) => {
        const next = { ...prev }
        if (v === null) delete next[key]
        else next[key] = v
        return next
      })
      saver.queue(key, v, delay)
    },
    [saver],
  )

  // Pick up other people's saves. Never overwrite a field this person is in
  // the middle of editing or has not finished saving.
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const merge = useCallback(
    (data: Values): boolean => {
      const prev = valuesRef.current
      const changes: [string, Value | undefined][] = []
      for (const k of new Set([...Object.keys(prev), ...Object.keys(data)])) {
        if (k === focused.current || saver.isDirty(k)) continue
        if (JSON.stringify(prev[k]) !== JSON.stringify(data[k])) changes.push([k, data[k]])
      }
      if (!changes.length) return false
      setValues((cur) => {
        const next = { ...cur }
        for (const [k, v] of changes) {
          if (k === focused.current || saver.isDirty(k)) continue
          if (v === undefined) delete next[k]
          else next[k] = v
        }
        return next
      })
      return true
    },
    [saver],
  )

  useEffect(() => {
    const iv = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await pollInstance(instanceId)
        if (!res.ok) {
          if (res.signedOut) setStatus({ kind: 'signedout' })
          return
        }
        const changed = merge(res.data)
        setLabel(res.label)
        if (changed && res.updatedBy) setNotice(`Updated with changes from ${res.updatedBy} at ${fmtTime(new Date())}.`)
      } catch {
        // offline; the next tick tries again
      }
    }, POLL_MS)
    return () => clearInterval(iv)
  }, [instanceId, merge])

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (saver.busy()) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [saver])

  // The house print CSS shows only body.print-one .sheet.active. Keep the
  // class on while this page is open so Ctrl+P prints the sheet too.
  useEffect(() => {
    document.body.classList.add('print-one')
    return () => document.body.classList.remove('print-one')
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  // ---------- field handlers ----------
  const textProps = (key: string) => ({
    value: typeof values[key] === 'string' ? (values[key] as string) : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setField(key, e.target.value, TEXT_DELAY_MS),
    onFocus: () => {
      focused.current = key
    },
    onBlur: () => {
      focused.current = null
      void saver.flush(key)
    },
  })

  const toggle = (key: string, options: ChoiceOption[], multi: boolean, o: ChoiceOption, checked: boolean) => {
    if (multi) {
      const cur = Array.isArray(values[key]) ? (values[key] as string[]) : []
      const next = options.filter((x) => (x.key === o.key ? checked : cur.includes(x.key))).map((x) => x.key)
      setField(key, next, 0)
    } else {
      setField(key, checked ? o.key : null, 0)
    }
    // GL-A6: the Medicaid personal needs allowance fills its $75 line.
    if (checked && o.autofill && empty(values[o.autofill.target])) setField(o.autofill.target, o.autofill.value, 0)
  }

  // ---------- panels ----------
  const openSummary = () => {
    setCopyMsg('')
    setPanel('summary')
    setTimeout(() => summaryRef.current?.select(), 0)
  }
  const copySummary = async () => {
    const text = summaryRef.current?.value ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg('Copied.')
    } catch {
      summaryRef.current?.select()
      try {
        document.execCommand('copy')
        setCopyMsg('Copied.')
      } catch {
        setCopyMsg('Select the text and copy it manually.')
      }
    }
  }
  // Saves anything still typing first: the PDF is made from the saved list.
  const downloadPdf = async () => {
    setPdfError(null)
    setPdfBusy(true)
    try {
      if (!(await saver.flushAll())) {
        setPdfError('Some changes have not saved yet, so the PDF would miss them. Try again in a moment.')
        return
      }
      const res = await fetch(`/l/${instanceId}/pdf`, { cache: 'no-store' })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/pdf')) {
        setPdfError(
          res.redirected
            ? 'You are signed out. Sign in again in a new tab, then try again.'
            : 'We could not make the PDF. Try again, or use Print and save as PDF.',
        )
        return
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'checklist.pdf'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      setPdfError('We could not reach the server to make the PDF. Try again.')
    } finally {
      setPdfBusy(false)
    }
  }

  const refreshHistory = async () => {
    setHistoryError(null)
    const res = await loadHistory(instanceId)
    if ('error' in res) setHistoryError(res.error)
    else setHistory(res.entries)
  }
  const openHistory = () => {
    setPanel('history')
    void refreshHistory()
  }
  const revert = async (revisionId: number) => {
    const res = await revertField(revisionId)
    if (!res.ok) return setHistoryError(res.error)
    const fresh = await pollInstance(instanceId)
    if (fresh.ok) {
      merge(fresh.data)
      setLabel(fresh.label)
    }
    setStatus({ kind: 'saved', at: new Date() })
    void refreshHistory()
  }

  const statusText =
    status.kind === 'saving'
      ? 'Saving...'
      : status.kind === 'saved'
        ? `Saved ${fmtTime(status.at)}`
        : status.kind === 'error'
          ? 'Not saved yet. Retrying.'
          : status.kind === 'signedout'
            ? 'Not saved: signed out'
            : 'Changes save as you type'

  return (
    <>
      <div className="crumbs noprint">
        <Link href="/">Matters</Link> / <Link href={`/cases/${p.caseId}`}>{p.caseName}</Link> /{' '}
        {renaming ? (
          <ActionForm action={renameInstance} className="inline">
            <input type="hidden" name="id" value={instanceId} />
            <input type="text" name="label" defaultValue={label} aria-label="List name" required maxLength={200} />
            <button className="btn primary" type="submit">
              Save name
            </button>
            <button className="btn quiet" type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </ActionForm>
        ) : (
          <>
            <b>{label}</b>{' '}
            <button className="linkbtn" type="button" onClick={() => setRenaming(true)}>
              Rename
            </button>
          </>
        )}
      </div>

      {status.kind === 'signedout' ? (
        <p className="formerr noprint" role="alert">
          You are signed out, so we cannot save. Your changes are still on this screen. Sign in again in a new tab
          (lists.gasperlegal.com), then come back here; we will save them automatically.
        </p>
      ) : null}
      {notice ? (
        <p className="formmsg noprint" role="status">
          {notice}
        </p>
      ) : null}
      {pdfError ? (
        <p className="formerr noprint" role="alert">
          {pdfError}
        </p>
      ) : null}

      <Sheet
        schema={schema}
        shown={shown}
        totals={totals}
        bind={{ text: textProps, toggle }}
        actions={
          <>
            <span className={`savestate ${status.kind}`} aria-live="polite">
              {statusText}
            </span>
            <button className="btn primary" type="button" onClick={openSummary}>
              Copy for BusinessMap
            </button>
            <button className="btn" type="button" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn" type="button" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? 'Preparing PDF...' : 'Download PDF'}
            </button>
            <button className="btn quiet" type="button" onClick={openHistory}>
              History
            </button>
          </>
        }
      />

      <Photos
        instanceId={instanceId}
        initial={p.attachments}
        canDelete={p.canDelete}
        style={{ '--accent': `var(--${schema.accent})`, '--accent-tint': `var(--${schema.accent}-tint)` } as React.CSSProperties}
      />

      {p.canDelete ? (
        <ActionForm action={deleteInstance} confirm={`Delete "${label}"? It is kept in the delete log.`} className="noprint">
          <input type="hidden" name="id" value={instanceId} />
          <input type="hidden" name="case_id" value={p.caseId} />
          <p style={{ marginTop: 10 }}>
            <button className="btn quiet" type="submit">
              Delete this list
            </button>
          </p>
        </ActionForm>
      ) : null}

      <div
        className={`panel${panel === 'summary' ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sumTitle"
        onClick={(e) => e.target === e.currentTarget && setPanel(null)}
      >
        <div className="inner">
          <h4 id="sumTitle">Summary for BusinessMap</h4>
          <p>Only the answered fields are included. Paste this into the asset card&apos;s description or a comment.</p>
          <textarea ref={summaryRef} readOnly value={panel === 'summary' ? summarize(schema, shown) : ''} />
          <div className="row">
            <span className="msg">{copyMsg}</span>
            <button className="btn quiet" type="button" onClick={() => setPanel(null)}>
              Close
            </button>
            <button className="btn primary" type="button" onClick={copySummary}>
              Copy text
            </button>
          </div>
        </div>
      </div>

      <HistoryPanel
        open={panel === 'history'}
        schema={schema}
        entries={history}
        error={historyError}
        canRevert={p.canRevert}
        onRevert={revert}
        onClose={() => setPanel(null)}
      />
    </>
  )
}
