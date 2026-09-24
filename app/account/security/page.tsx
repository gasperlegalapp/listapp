import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { env } from '@/lib/env'
import { safeNext } from '@/lib/session-policy'
import { ActionForm } from '@/components/action-form'
import { removeFactor } from '../actions'
import { EnrollFlow } from './enroll-flow'

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireUser({ allowMissingMfa: true })
  const sp = await searchParams
  const next = safeNext(sp.next)
  const { data } = await supabase.auth.mfa.listFactors()
  const verified = data?.totp ?? []

  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>Two-step sign-in</h2>
          <p className="sub">
            An authenticator app (Microsoft Authenticator, Google Authenticator, 1Password) adds a 6-digit code to
            every sign-in.
          </p>
        </div>
      </div>
      {sp.required === '1' && verified.length === 0 ? (
        <p className="formerr">The firm requires two-step sign-in. Set it up to continue.</p>
      ) : null}
      {verified.length > 0 ? (
        <>
          <p className="formmsg">Two-step sign-in is on.</p>
          {!env.mfaRequired
            ? verified.map((f) => (
                <ActionForm key={f.id} action={removeFactor} confirm="Turn off two-step sign-in?">
                  <input type="hidden" name="factorId" value={f.id} />
                  <p style={{ marginTop: 12 }}>
                    <button className="btn quiet" type="submit">
                      Turn off
                    </button>
                  </p>
                </ActionForm>
              ))
            : null}
        </>
      ) : (
        <EnrollFlow next={next} />
      )}
      <p className="foot">
        <Link href="/">Back to List App</Link>
      </p>
    </main>
  )
}
