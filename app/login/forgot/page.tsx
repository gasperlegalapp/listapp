import Link from 'next/link'
import { ActionForm } from '@/components/action-form'
import { requestReset } from '../actions'

export default function ForgotPage() {
  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>Reset your password</h2>
          <p className="sub">We will email you a link to choose a new one.</p>
        </div>
      </div>
      <ActionForm action={requestReset}>
        <div className="grid">
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" autoComplete="username" required autoFocus />
          </div>
          <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
            <button className="btn primary" type="submit">
              Email me a reset link
            </button>
          </div>
        </div>
      </ActionForm>
      <p className="foot">
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  )
}
