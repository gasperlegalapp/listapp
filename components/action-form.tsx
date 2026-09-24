'use client'

import { useActionState } from 'react'
import type { FormAction } from '@/lib/form-state'

// A <form> bound to a server action, with inline error/success text and the
// fields disabled while the action runs. `confirm` asks before submitting.
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: FormAction
  children: React.ReactNode
  className?: string
  confirm?: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      <fieldset disabled={pending}>{children}</fieldset>
      {state.error ? (
        <p className="formerr" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="formmsg" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
