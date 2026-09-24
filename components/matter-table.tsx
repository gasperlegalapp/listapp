'use client'

import Link from 'next/link'
import { useState } from 'react'

export type MatterRow = {
  id: string
  name: string
  case_number: string | null
  county: string | null
  type: string
  lists: number
}

// Matters with a find-as-you-type filter.
export function MatterTable({ rows }: { rows: MatterRow[] }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rows.filter((r) => [r.name, r.case_number, r.county].some((v) => v?.toLowerCase().includes(needle)))
    : rows
  return (
    <>
      <div className="fld findbox">
        <label htmlFor="find">Find a matter</label>
        <input type="text" id="find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, case no. or county" />
      </div>
      <div className="tbl">
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
