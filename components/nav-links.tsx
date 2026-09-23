'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname()
  return links.map((l) => {
    const current = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
    return (
      <Link key={l.href} href={l.href} className="tab" aria-current={current ? 'page' : undefined}>
        {l.label}
      </Link>
    )
  })
}
