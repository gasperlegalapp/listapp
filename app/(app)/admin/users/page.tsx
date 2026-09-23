import { requireRole, type Role } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ActionForm } from '@/components/action-form'
import { inviteUser, resendInvite, resetMfa, setActive, setRole } from './actions'

type Row = { id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string }

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) : '--'

export default async function UsersPage() {
  const { supabase, profile: me } = await requireRole('admin')
  const { data: rows } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, active, created_at')
    .order('active', { ascending: false })
    .order('full_name')
    .returns<Row[]>()

  const admin = createAdminClient()
  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const auth = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Admin</div>
        <h2>Users</h2>
        <p className="sub">
          Only people invited here can sign in. Leavers are deactivated, never deleted, so their history stays.
        </p>
      </div>

      <section className="matter" style={{ marginTop: 0 }}>
        <div className="ttl">Invite someone</div>
        <ActionForm action={inviteUser}>
          <div className="grid">
            <div className="fld" style={{ '--w': 2 } as React.CSSProperties}>
              <label htmlFor="full_name">Name</label>
              <input type="text" id="full_name" name="full_name" required />
            </div>
            <div className="fld" style={{ '--w': 2 } as React.CSSProperties}>
              <label htmlFor="email">Email</label>
              <input type="email" id="email" name="email" required />
            </div>
            <div className="fld" style={{ '--w': 1 } as React.CSSProperties}>
              <label htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="attorney">Attorney</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="fld" style={{ '--w': 1, alignSelf: 'end' } as React.CSSProperties}>
              <button className="btn primary" type="submit">
                Send invite
              </button>
            </div>
          </div>
        </ActionForm>
      </section>

      <div className="tbl" style={{ marginTop: 24 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th>2-step</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const a = auth.get(r.id)
              const pending = !a?.last_sign_in_at
              const mfa = (a?.factors ?? []).some((f) => f.status === 'verified')
              const self = r.id === me.id
              return (
                <tr key={r.id}>
                  <td>{r.full_name || '--'}</td>
                  <td className="cell">{r.email}</td>
                  <td className="cell">
                    {self ? (
                      r.role
                    ) : (
                      <ActionForm action={setRole}>
                        <input type="hidden" name="id" value={r.id} />
                        <span className="acts">
                          <select name="role" defaultValue={r.role} aria-label={`Role for ${r.full_name}`}>
                            <option value="staff">staff</option>
                            <option value="attorney">attorney</option>
                            <option value="admin">admin</option>
                          </select>
                          <button className="btn quiet" type="submit">
                            Save
                          </button>
                        </span>
                      </ActionForm>
                    )}
                  </td>
                  <td className="cell">
                    {!r.active ? (
                      <span className="pill stamp">Deactivated</span>
                    ) : pending ? (
                      <span className="pill gold">Invite pending</span>
                    ) : (
                      <span className="pill ok">Active</span>
                    )}
                  </td>
                  <td className="cell">{fmt(a?.last_sign_in_at)}</td>
                  <td className="cell">{mfa ? 'On' : 'Off'}</td>
                  <td className="cell">
                    {self ? null : (
                      <div className="acts">
                        {r.active && pending ? (
                          <ActionForm action={resendInvite}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="btn quiet" type="submit">
                              Resend invite
                            </button>
                          </ActionForm>
                        ) : null}
                        {mfa ? (
                          <ActionForm action={resetMfa} confirm={`Remove ${r.full_name}'s authenticator app?`}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="btn quiet" type="submit">
                              Reset 2-step
                            </button>
                          </ActionForm>
                        ) : null}
                        <ActionForm
                          action={setActive}
                          confirm={r.active ? `Deactivate ${r.full_name}? They will be signed out and blocked.` : undefined}
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="active" value={r.active ? 'false' : 'true'} />
                          <button className="btn quiet" type="submit">
                            {r.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </ActionForm>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
