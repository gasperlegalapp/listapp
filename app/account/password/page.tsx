import { requireSession } from '@/lib/auth'
import { ActionForm } from '@/components/action-form'
import { setPassword } from '../actions'

export default async function PasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession()
  const welcome = (await searchParams).welcome === '1'
  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>{welcome ? 'Choose your password' : 'Choose a new password'}</h2>
          <p className="sub">At least 12 characters. A short sentence you will remember works well.</p>
        </div>
      </div>
      <ActionForm action={setPassword}>
        <div className="grid">
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <label htmlFor="password">New password</label>
            <input type="password" id="password" name="password" autoComplete="new-password" minLength={12} required autoFocus />
          </div>
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <label htmlFor="confirm">Type it again</label>
            <input type="password" id="confirm" name="confirm" autoComplete="new-password" minLength={12} required />
          </div>
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <button className="btn primary" type="submit">
              Save password
            </button>
          </div>
        </div>
      </ActionForm>
    </main>
  )
}
