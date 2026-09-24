'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type MatterRow = {
  id: string
  name: string
  case_number: string | null
  county: string | null
  type: string
  lists: number
}

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

// Matters A to Z with a find-as-you-type filter. The table shows about ten
// rows and scrolls inside its own box, with the column headings pinned.
export function MatterTable({ rows }: { rows: MatterRow[] }) {
  const findId = useId()
  const [q, setQ] = useState('')
  const sorted = useMemo(() => [...rows].sort((a, b) => byName.compare(a.name, b.name)), [rows])
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? sorted.filter((r) => [r.name, r.case_number, r.county].some((v) => v?.toLowerCase().includes(needle)))
    : sorted
  // Size the box to exactly the heading plus the first ten rows, whatever
  // the screen width does to row heights.
  const box = useRef<HTMLDivElement>(null)
  const [maxH, setMaxH] = useState<number | undefined>(undefined)
  useEffect(() => {
    const measure = () => {
      const el = box.current
      const tenth = el?.querySelector<HTMLTableRowElement>('tbody tr:nth-child(10)')
      setMaxH(el && tenth && shown.length > 10 ? tenth.offsetTop + tenth.offsetHeight + 1 : undefined)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [shown.length])
  const count = needle ? `${shown.length} of ${rows.length} matters` : `${rows.length} matter${rows.length === 1 ? '' : 's'}`
  return (
    <>
      <div className="fld findbox">
        <label htmlFor={findId}>Find a matter</label>
        <input type="text" id={findId} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, case no. or county" />
      </div>
      <p className="tblnote">
        {count}, A to Z{shown.length > 10 ? '. Scroll the list for more.' : '.'}
      </p>
      <div className="tbl scrollbox" ref={box} style={{ maxHeight: maxH ?? 'none' }}>
        <table>
          <thead>
            <tr>
              <th>Matter</th>
              <th>Case no.</th>
              <th>County</th>
              <th>Type</th>
              <th>Lists</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/cases/${r.id}`}>{r.name}</Link>
                </td>
                <td className="cell">{r.case_number || '--'}</td>
                <td className="cell">{r.county || '--'}</td>
                <td className="cell">{r.type}</td>
                <td className="cell">{r.lists}</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="cell">
                  {rows.length ? 'No matters match.' : 'No matters yet. Start one with New matter.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}
