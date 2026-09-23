import Link from 'next/link'
import { ActionForm } from '@/components/action-form'
import { confirmToken } from './actions'

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const type = sp.type === 'invite' ? 'invite' : sp.type === 'recovery' ? 'recovery' : null
  const tokenHash = sp.token_hash ?? ''
  return (
    <main className="auth">
      <div className="sheethead">
        <div>
          <div className="code">Gasper Legal</div>
          <h2>{type === 'invite' ? 'Welcome' : 'Reset your password'}</h2>
          <p className="sub">
            {type === 'invite'
              ? 'We have set up your List App account. Continue to choose your password.'
              : 'Continue to choose a new password.'}
          </p>
        </div>
      </div>
      {type && tokenHash ? (
        <ActionForm action={confirmToken}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <button className="btn primary" type="submit">
            Continue
          </button>
        </ActionForm>
      ) : (
        <p className="formerr">This link is incomplete. Open it again from the email.</p>
      )}
      <p className="foot">
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  )
}
