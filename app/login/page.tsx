import { safeNext } from '@/lib/session-policy'
import { LoginForm } from './login-form'

const REASONS: Record<string, string> = {
  inactive: 'This account has been deactivated. Ask an admin if you need access.',
  expired: 'Your session ended. Sign in again to continue.',
  signedout: 'You are signed out.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const next = safeNext(sp.next)
  const reason = sp.reason ? REASONS[sp.reason] : undefined
  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>Sign in</h2>
          <p className="sub">Asset, income and budget checklists.</p>
        </div>
      </div>
      {reason ? <p className="formmsg">{reason}</p> : null}
      <LoginForm next={next} />
    </main>
  )
}
