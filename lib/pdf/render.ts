import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer, { type Browser } from 'puppeteer-core'
import { escapeHtml } from './static-markup'

// Server-side PDF of a checklist: the same sheet markup and the same house
// print CSS, printed by headless Chromium. On Vercel (and any Linux x64) the
// browser is @sparticuz/chromium; set CHROMIUM_PATH to use a local Chrome
// instead (for example on a Mac).
//
// Chromium only ever sees our own markup. JavaScript is off, a CSP forbids
// scripts and network, and every request that is not a data: URL is refused,
// so nothing typed into a list can make it fetch or run anything.

const ROOT = process.cwd()
const FONTS: [family: string, file: string, style: string, weight: string][] = [
  ['Archivo', 'archivo-latin.woff2', 'normal', '100 900'],
  ['Source Serif 4', 'source-serif-4-latin.woff2', 'normal', '200 900'],
  ['Source Serif 4', 'source-serif-4-italic-latin.woff2', 'italic', '200 900'],
  ['IBM Plex Mono', 'ibm-plex-mono-400-latin.woff2', 'normal', '400'],
  ['IBM Plex Mono', 'ibm-plex-mono-500-latin.woff2', 'normal', '500'],
]

let assets: Promise<string> | null = null

// House CSS, app CSS and embedded fonts, read once per server instance.
function styles(): Promise<string> {
  assets ??= (async () => {
    const [house, app, ...fonts] = await Promise.all([
      readFile(join(ROOT, 'styles', 'checklists.css'), 'utf8'),
      readFile(join(ROOT, 'styles', 'app.css'), 'utf8'),
      ...FONTS.map(([, file]) => readFile(join(ROOT, 'lib', 'pdf', 'fonts', file))),
    ])
    const faces = FONTS.map(
      ([family, , style, weight], i) =>
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;` +
        `src:url(data:font/woff2;base64,${fonts[i].toString('base64')}) format("woff2")}`,
    ).join('\n')
    // app.css points the stacks at next/font variables; name the faces here instead.
    const vars = ':root{--font-archivo:"Archivo";--font-serif:"Source Serif 4";--font-mono:"IBM Plex Mono"}'
    return [faces, house, app, vars].join('\n')
  })().catch((e) => {
    assets = null
    throw e
  })
  return assets
}

export async function checklistDocument(title: string, sheetHtml: string): Promise<string> {
  const css = await styles()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body class="print-one"><main class="wrap page">${sheetHtml}</main></body>
</html>`
}

async function launch(): Promise<Browser> {
  const local = process.env.CHROMIUM_PATH
  if (local) return puppeteer.launch({ executablePath: local, headless: true })
  chromium.setGraphicsMode = false
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    headless: 'shell',
  })
}

// One Chromium at a time per server instance, so a burst of downloads queues
// instead of running the function out of memory.
let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

export function htmlToPdf(html: string, footerLeft: string, footerRight: string): Promise<Uint8Array> {
  return oneAtATime(async () => {
    const browser = await launch()
    try {
      const page = await browser.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', (r) => {
        if (r.url().startsWith('data:')) void r.continue()
        else void r.abort()
      })
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 })
      const foot =
        '<div style="width:100%;margin:0 .5in;display:flex;justify-content:space-between;gap:12px;' +
        'font-family:Archivo,sans-serif;font-size:7pt;color:#7C8A82">' +
        `<span>${escapeHtml(footerLeft)}</span>` +
        `<span style="white-space:nowrap">${escapeHtml(footerRight)} - Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
        '</div>'
      return await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: foot,
        timeout: 30000,
      })
    } finally {
      await browser.close().catch(() => undefined)
    }
  })
}
