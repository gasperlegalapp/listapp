// The checklist sheet itself: header, Matter box, Do first, sections, wrap-up.
// Markup mirrors the reference HTML's field(). One component serves both the
// live form (with `bind`) and the PDF (without it: a static snapshot with no
// handlers, rendered on the server by lib/pdf/static-markup.ts). No hooks here,
// so it can render outside React.

import { MATTER_FROM_CASE } from '@/lib/templates/matter'
import type { Totals } from '@/lib/templates/budget'
import type { ChoiceOption, Row, TemplateSchema } from '@/lib/templates/types'
import { cellKey, type Values } from '@/lib/templates/values'
import { NoteHtml } from './note-html'

export type TextBinding = {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onFocus: () => void
  onBlur: () => void
}

export type SheetBinding = {
  text: (key: string) => TextBinding
  toggle: (key: string, options: ChoiceOption[], multi: boolean, o: ChoiceOption, checked: boolean) => void
}

type Props = {
  schema: TemplateSchema
  shown: Values // stored answers with the matter's values laid over them
  totals: Totals
  bind?: SheetBinding
  actions?: React.ReactNode
}

const W = (w: number) => ({ '--w': w }) as React.CSSProperties
const pad = (n: number) => String(n).padStart(2, '0')

// A static textarea cannot scroll, so grow it to fit what was written rather
// than clip it. Errs long: a spare ruled line is harmless, a lost one is not.
const CHARS_PER_LINE = 90
export function linesFor(text: string) {
  return text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / CHARS_PER_LINE)), 0)
}

export function Sheet({ schema, shown, totals, bind, actions }: Props) {
  const str = (key: string) => (typeof shown[key] === 'string' ? (shown[key] as string) : '')
  const isChecked = (key: string, opt: string) => {
    const v = shown[key]
    return Array.isArray(v) ? v.includes(opt) : v === opt
  }

  const textInput = (key: string, id?: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) =>
    bind ? (
      <input type="text" id={id} {...extra} {...bind.text(key)} />
    ) : (
      <input type="text" id={id} {...extra} readOnly defaultValue={str(key)} />
    )

  const box = (key: string, options: ChoiceOption[], multi: boolean, o: ChoiceOption, locked = false) =>
    bind ? (
      <input
        type="checkbox"
        checked={isChecked(key, o.key)}
        disabled={locked}
        onChange={(e) => bind.toggle(key, options, multi, o, e.target.checked)}
      />
    ) : (
      <input type="checkbox" defaultChecked={isChecked(key, o.key)} />
    )

  const renderRow = (r: Row, i: number, lockMatter = false) => {
    switch (r.type) {
      case 'subhead':
        return <div key={i} className="subhead">{r.text}</div>
      case 'tip':
        return <NoteHtml key={i} className="note" html={r.html} />
      case 'warn':
        return <NoteHtml key={i} className="note warn" html={r.html} />
      case 'explain':
        return (
          <div key={i} className="explain">
            {r.items.map(([b, t]) => (
              <div key={b}>
                <b>{b}</b>
                <p>{t}</p>
              </div>
            ))}
          </div>
        )
      case 'settled':
        return (
          <div key={i} className="settled">
            <b>What &quot;Settled&quot; means.</b> {r.text}
          </div>
        )
      case 'tasks':
        return (
          <div key={r.key} className="chips steplist">
            {r.options.map((o) => (
              <label key={o.key} className="chip">
                {box(r.key, r.options, true, o)}
                <span className="box"></span>
                {o.label}
              </label>
            ))}
          </div>
        )
      case 'table':
        return (
          <div key={r.key} className="tbl">
            <table>
              <thead>
                <tr>
                  {r.cols.map((c, ci) => (
                    <th key={ci}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((rowLabel, ri) => (
                  <tr key={ri}>
                    <td>{rowLabel}</td>
                    {r.cols.slice(1).map((c, ci) => (
                      <td key={ci}>
                        {textInput(cellKey(r.key, ri + 1, ci + 1), undefined, {
                          'aria-label': `${rowLabel} ${c}`,
                          inputMode: ci + 1 === r.sum ? 'decimal' : undefined,
                        })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {r.sum != null ? (
                <tfoot>
                  <tr>
                    <td>{r.totLabel || 'Total'}</td>
                    {r.cols.slice(1).map((_, ci) => (
                      <td key={ci}>{ci + 1 === r.sum ? totals.tables[r.key] : ''}</td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )
      case 'computed':
        return (
          <div key={r.key} className={`fld${r.w <= 1 ? ' w1' : ''}`} style={W(r.w)}>
            <label htmlFor={`f-${r.key}`}>{r.label}</label>
            <input type="text" id={`f-${r.key}`} readOnly className="auto" value={totals.auto[r.auto]} />
          </div>
        )
      case 'text': {
        const fromCase = lockMatter && MATTER_FROM_CASE.has(r.key)
        return (
          <div key={r.key} className={`fld${r.w <= 1 ? ' w1' : ''}`} style={W(r.w)}>
            <label htmlFor={`f-${r.key}`}>{r.label}</label>
            {fromCase ? (
              <input
                type="text"
                id={`f-${r.key}`}
                readOnly
                value={str(r.key)}
                title="From the matter. Change it with Edit matter details on the matter page."
              />
            ) : (
              textInput(r.key, `f-${r.key}`)
            )}
            {r.hint ? <div className="hint">{r.hint}</div> : null}
          </div>
        )
      }
      case 'textarea': {
        const text = str(r.key)
        const need = bind ? 0 : linesFor(text)
        return (
          <div key={r.key} className="fld" style={W(6)}>
            <label htmlFor={`f-${r.key}`}>{r.label}</label>
            {bind ? (
              <textarea id={`f-${r.key}`} rows={r.rows} {...bind.text(r.key)} />
            ) : (
              <textarea
                id={`f-${r.key}`}
                rows={Math.max(r.rows, need)}
                style={need > r.rows ? { height: 'auto' } : undefined}
                readOnly
                defaultValue={text}
              />
            )}
            {r.hint ? <div className="hint">{r.hint}</div> : null}
          </div>
        )
      }
      case 'choice': {
        const fromCase = lockMatter && MATTER_FROM_CASE.has(r.key)
        return (
          <div key={r.key} className={`fld${r.w <= 1 ? ' w1' : ''}`} style={W(r.w)} role="group" aria-label={r.label}>
            <span className="lbl">{r.label}</span>
            <div className="chips">
              {r.options.map((o) => (
                <label key={o.key} className={`chip${r.multi ? '' : ' round'}`}>
                  {box(r.key, r.options, r.multi, o, fromCase)}
                  <span className="box"></span>
                  {o.label}
                </label>
              ))}
            </div>
            {r.hint ? <div className="hint">{r.hint}</div> : null}
          </div>
        )
      }
    }
  }

  return (
    <article
      className="sheet active"
      id={schema.slug}
      style={{ '--accent': `var(--${schema.accent})`, '--accent-tint': `var(--${schema.accent}-tint)` } as React.CSSProperties}
    >
      <div className="sheethead">
        <div>
          <div className="code">{schema.code}</div>
          <h2>{schema.title} Checklist</h2>
          <p className="sub">{schema.sub}</p>
          <div className="legend">
            <span>
              <i className="r"></i>Pick one
            </span>
            <span>
              <i></i>Check all that apply
            </span>
          </div>
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>

      <section className="matter">
        <div className="ttl">Matter</div>
        <div className="grid">{schema.matter.map((r, i) => renderRow(r, i, true))}</div>
      </section>

      <section className="first">
        <div className="ttl">Do these first</div>
        <div className="tasks chips">
          {schema.first.options.map((o) => (
            <label key={o.key} className="chip task">
              {box('first', schema.first.options, true, o)}
              <span className="box"></span>
              {o.label}
            </label>
          ))}
        </div>
      </section>

      {schema.sections.map((sec) => (
        <section key={sec.key} className="sec">
          <div className="sechead">
            <span className="n">{pad(sec.n)}</span>
            <h3>{sec.title}</h3>
          </div>
          <div className="grid">{sec.rows.map((r, i) => renderRow(r, i))}</div>
        </section>
      ))}

      <section className="signoff">
        <div className="grid">{schema.signoff.map((r, i) => renderRow(r, i))}</div>
      </section>
    </article>
  )
}
