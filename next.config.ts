import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The PDF route reads these at runtime; make sure Vercel ships them with it.
  // (@sparticuz/chromium and puppeteer-core are external by default.)
  outputFileTracingIncludes: {
    '/l/*/pdf': [
      './styles/checklists.css',
      './styles/app.css',
      './lib/pdf/fonts/*.woff2',
      './node_modules/@sparticuz/chromium/bin/**',
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
