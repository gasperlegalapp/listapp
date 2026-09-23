import type { Metadata, Viewport } from 'next'
import { Archivo, IBM_Plex_Mono, Source_Serif_4 } from 'next/font/google'
import '@/styles/checklists.css'
import '@/styles/app.css'

const archivo = Archivo({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-archivo', display: 'swap' })
const serif = Source_Serif_4({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-serif',
  display: 'swap',
})
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'List App | Gasper Legal',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
