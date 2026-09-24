'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signIn } from './actions'

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, {})
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <fieldset disabled={pending} className="grid">
        <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
          <label htmlFor="email">Email</label>
          <input type="email" id="email" name="email" autoComplete="username" required autoFocus />
        </div>
        <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
          <label htmlFor="password">Password</label>
          <input type="password" id="password" name="password" autoComplete="current-password" required />
        </div>
        <div className="fld" style={{ '--w': 6 } as React.CSSProperties}>
          <div className="row">
            <label className="chip">
              <input type="checkbox" name="remember" />
              <span className="box"></span>Keep me signed in for 3 days
            </label>
            <button className="btn primary" type="submit">
              {pending ? 'Signing in' : 'Sign in'}
            </button>
          </div>
        </div>
      </fieldset>
      {state.error ? (
        <p className="formerr" role="alert">
          {state.error}
        </p>
      ) : null}
      <p className="foot">
        <Link href="/login/forgot">Forgot your password?</Link>
      </p>
    </form>
  )
}
