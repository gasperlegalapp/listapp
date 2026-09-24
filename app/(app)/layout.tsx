import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { NavLinks } from '@/components/nav-links'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser()
  const links = [{ href: '/', label: 'Matters' }]
  if (profile.role === 'admin') links.push({ href: '/admin/templates', label: 'Checklists' }, { href: '/admin/users', label: 'Users' })
  if (profile.role !== 'staff') links.push({ href: '/admin/deleted', label: 'Delete log' })
  return (
    <>
      <nav className="noprint" aria-label="Main">
        <div className="navin">
          <Link href="/" className="navmark" style={{ textDecoration: 'none' }}>
            Gasper Legal
          </Link>
          <NavLinks links={links} />
          <span className="navspacer" />
          <Link href="/account/security" className="navuser">
            {profile.full_name || profile.email}
          </Link>
          <form action="/auth/signout" method="post">
            <button className="tab" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      <main className="wrap page">{children}</main>
      <footer className="noprint">
        <div className="wrap">
          <div>
            <div className="fm">Gasper Legal</div>
            <p style={{ marginTop: 8 }}>Asset, Income and Budget Checklists GL-A1 through GL-A6.</p>
          </div>
        </div>
      </footer>
    </>
  )
}
