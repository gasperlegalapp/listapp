import { MATTER_TYPES, OUR_ROLES, type CaseRecord } from '@/lib/templates/matter'

const W = (w: number) => ({ '--w': w }) as React.CSSProperties

// Matter fields, laid out in the house grid. Used for "New matter" and
// "Edit matter". These values fill the Matter box on every list.
export function CaseFields({ c }: { c?: Partial<CaseRecord> }) {
  return (
    <div className="grid">
      <div className="fld" style={W(4)}>
        <label htmlFor="cf-name">Matter / case name</label>
        <input type="text" id="cf-name" name="name" defaultValue={c?.name ?? ''} required maxLength={300} />
        <div className="hint">For example: Blair, Gary M. -- Guardianship</div>
      </div>
      <div className="fld" style={W(2)}>
        <label htmlFor="cf-num">Case no.</label>
        <input type="text" id="cf-num" name="case_number" defaultValue={c?.case_number ?? ''} maxLength={100} />
      </div>
      <div className="fld" style={W(6)} role="group" aria-label="Matter type">
        <span className="lbl">Matter type</span>
        <div className="chips">
          {MATTER_TYPES.map(([k, label]) => (
            <label key={k} className="chip round">
              <input type="radio" name="matter_type" value={k} defaultChecked={c?.matter_type === k} required />
              <span className="box"></span>
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="fld" style={W(6)} role="group" aria-label="Our role">
        <span className="lbl">Our role</span>
        <div className="chips">
          {OUR_ROLES.map(([k, label]) => (
            <label key={k} className="chip round">
              <input type="radio" name="our_role" value={k} defaultChecked={c?.our_role === k} />
              <span className="box"></span>
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="fld" style={W(2)}>
        <label htmlFor="cf-ward">Ward / decedent</label>
        <input type="text" id="cf-ward" name="ward_or_decedent" defaultValue={c?.ward_or_decedent ?? ''} maxLength={300} />
      </div>
      <div className="fld" style={W(2)}>
        <label htmlFor="cf-county">County</label>
        <input type="text" id="cf-county" name="county" defaultValue={c?.county ?? ''} maxLength={100} />
      </div>
      <div className="fld" style={W(2)}>
        <label htmlFor="cf-court">Court</label>
        <input type="text" id="cf-court" name="court" defaultValue={c?.court ?? ''} maxLength={200} />
      </div>
      <div className="fld" style={W(3)}>
        <label htmlFor="cf-date">Date of death or appointment</label>
        <input type="date" id="cf-date" name="valuation_date" defaultValue={c?.valuation_date ?? ''} />
        <div className="hint">This is the valuation date for the inventory.</div>
      </div>
    </div>
  )
}
