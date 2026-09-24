import { requireSession } from '@/lib/auth'
import { safeNext } from '@/lib/session-policy'
import { ActionForm } from '@/components/action-form'
import { verifyMfa } from '../actions'

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession()
  const next = safeNext((await searchParams).next)
  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>Enter your code</h2>
          <p className="sub">Open your authenticator app and enter the 6-digit code for List App.</p>
        </div>
      </div>
      <ActionForm action={verifyMfa}>
        <input type="hidden" name="next" value={next} />
        <div className="grid">
          <div className="fld" style={{ '--w': 3 } as React.CSSProperties}>
            <label htmlFor="code">Code</label>
            <input
              type="text"
              id="code"
              name="code"
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              autoFocus
            />
          </div>
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <button className="btn primary" type="submit">
              Verify
            </button>
          </div>
        </div>
      </ActionForm>
      <form action="/auth/signout" method="post" className="foot">
        <button className="btn quiet" type="submit">
          Sign out
        </button>
      </form>
    </main>
  )
}
