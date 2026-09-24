'use client'

import { useMemo, useState } from 'react'
import { formatStored, keyIndex } from '@/lib/templates/labels'
import type { TemplateSchema } from '@/lib/templates/types'
import { fmtWhen } from '@/lib/format'
import type { HistoryEntry } from '@/app/(app)/l/[id]/actions'

type Group = {
  key: string
  by: string
  newest: string
  oldest: string
  oldestId: number
  oldValue: unknown
  newValue: unknown
  count: number
}

const GROUP_WINDOW_MS = 10 * 60 * 1000

// Autosave writes a revision at every pause in typing. For reading, runs of
// typing by one person in one text field within 10 minutes show as a single
// change (first value -> last value). Choice clicks are deliberate and always
// show individually. Every underlying revision is still stored.
export function groupHistory(entries: HistoryEntry[], isText: (key: string) => boolean): Group[] {
  const groups: Group[] = []
  const open = new Map<string, Group>()
  for (const e of entries) {
    // entries are newest first
    const g = isText(e.key) ? open.get(e.key) : undefined
    if (g && g.by === e.by && new Date(g.oldest).getTime() - new Date(e.at).getTime() <= GROUP_WINDOW_MS) {
      g.oldest = e.at
      g.oldestId = e.id
      g.oldValue = e.old
      g.count++
      continue
    }
    const ng: Group = { key: e.key, by: e.by, newest: e.at, oldest: e.at, oldestId: e.id, oldValue: e.old, newValue: e.new, count: 1 }
    groups.push(ng)
    open.set(e.key, ng)
  }
  return groups
}

export function HistoryPanel(props: {
  open: boolean
  schema: TemplateSchema
  entries: HistoryEntry[] | null
  error: string | null
  canRevert: boolean
  onRevert: (revisionId: number) => Promise<void>
  onClose: () => void
}) {
  const idx = useMemo(() => keyIndex(props.schema), [props.schema])
  const groups = useMemo(
    () => groupHistory(props.entries ?? [], (k) => k !== '_label' && !idx.get(k)?.options),
    [props.entries, idx],
  )
  const [busy, setBusy] = useState<number | null>(null)

  return (
    <div
      className={`panel${props.open ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="histTitle"
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="inner">
        <h4 id="histTitle">History</h4>
        <p>
          Every change to this list, newest first.
          {props.canRevert ? ' Revert puts one field back the way it was before that change; the revert is recorded too.' : ''}
        </p>
        <div className="scroll">
          {props.error ? <p className="formerr">{props.error}</p> : null}
          {props.entries === null && !props.error ? <p>Loading...</p> : null}
          {props.entries && groups.length === 0 ? <p>No changes yet.</p> : null}
          {groups.map((g) => {
            const info = idx.get(g.key)
            return (
              <div key={g.oldestId} className="hist">
                <div>
                  <b>{info?.label ?? g.key}</b> <span className="histsec">{info?.section}</span>
                </div>
                <div className="histchg">
                  <span className="was">{formatStored(info, g.oldValue)}</span> {' -> '} <span>{formatStored(info, g.newValue)}</span>
                </div>
                <div className="histwho">
                  {g.by} - {fmtWhen(g.newest)}
                  {g.count > 1 ? ` (${g.count} saves)` : ''}
                  {props.canRevert ? (
                    <button
                      className="linkbtn"
                      type="button"
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(g.oldestId)
                        await props.onRevert(g.oldestId)
                        setBusy(null)
                      }}
                    >
                      {busy === g.oldestId ? 'Reverting...' : 'Revert'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        <div className="row">
          <button className="btn quiet" type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
