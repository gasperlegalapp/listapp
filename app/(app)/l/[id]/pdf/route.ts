import { createElement } from 'react'
import { loadInstance } from '@/lib/instances'
import { fmtWhen } from '@/lib/format'
import { pdfFileName } from '@/lib/pdf/filename'
import { checklistDocument, htmlToPdf } from '@/lib/pdf/render'
import { renderStatic } from '@/lib/pdf/static-markup'
import { computeTotals } from '@/lib/templates/budget'
import { matterValues } from '@/lib/templates/matter'
import { Sheet } from '@/components/checklist/sheet'

// /l/<id>/pdf: the filled list as a PDF download, printed from the same
// markup and print CSS as the Print button. Access is the same as the form:
// requireUser (inside loadInstance) and RLS.

export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await loadInstance((await params).id)
  if (!r) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  const { inst, schema, c } = r

  const shown = { ...inst.data, ...matterValues(c) }
  const sheet = renderStatic(createElement(Sheet, { schema, shown, totals: computeTotals(schema, inst.data) }))
  const title = `${schema.code} ${inst.label}`
  const now = new Date()

  let pdf: Uint8Array
  try {
    pdf = await htmlToPdf(
      await checklistDocument(title, sheet),
      `${schema.code} v${inst.template_version} - ${inst.label} - ${c.name}`,
      `Made ${fmtWhen(now.toISOString())} ET`,
    )
  } catch (e) {
    console.error('pdf: render failed', { id: inst.id, message: e instanceof Error ? e.message : String(e) })
    return new Response('We could not make the PDF.', { status: 500, headers: { 'Cache-Control': 'private, no-store' } })
  }

  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(schema.code, inst.label, now)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
