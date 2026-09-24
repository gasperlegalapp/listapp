'use client'

import { useActionState } from 'react'
import { confirmEnroll, startEnroll, type EnrollState } from '../actions'

export function EnrollFlow({ next }: { next: string }) {
  const [started, start, starting] = useActionState(startEnroll, {} as EnrollState)
  const [confirmed, confirm, confirming] = useActionState(confirmEnroll, {} as EnrollState)

  if (!started.factorId) {
    return (
      <form action={start}>
        <button className="btn primary" type="submit" disabled={starting}>
          Set up authenticator app
        </button>
        {started.error ? <p className="formerr">{started.error}</p> : null}
      </form>
    )
  }

  return (
    <div className="grid">
      <div className="fld" style={{ '--w': 3 } as React.CSSProperties}>
        <span className="lbl">1. Scan this with your authenticator app</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Supabase */}
        <img className="qr" src={started.qr} alt="QR code for your authenticator app" />
        <div className="hint">
          Cannot scan? Enter this key instead: <span className="secret">{started.secret}</span>
        </div>
      </div>
      <form action={confirm} className="fld" style={{ '--w': 3 } as React.CSSProperties}>
        <input type="hidden" name="factorId" value={started.factorId} />
        <input type="hidden" name="next" value={next} />
        <label htmlFor="code">2. Enter the 6-digit code it shows</label>
        <input
          type="text"
          id="code"
          name="code"
          className="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          autoFocus
        />
        <p style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={confirming}>
            Turn it on
          </button>
        </p>
        {confirmed.error ? <p className="formerr">{confirmed.error}</p> : null}
      </form>
    </div>
  )
}
