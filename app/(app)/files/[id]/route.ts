import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { isUuid } from '@/lib/ids'

// /files/<attachment id>: a short redirect to a signed Storage URL. Pages
// link here rather than to Storage, so a link never goes stale and every view
// is re-checked against RLS. ?download=1 saves instead of opening.

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuth()
  if (!auth.ok) return new NextResponse('Signed out', { status: 401, headers: NO_STORE })
  if (!isUuid(id)) return new NextResponse('Not found', { status: 404, headers: NO_STORE })

  const { data: att } = await auth.supabase
    .from('attachments')
    .select('storage_path, file_name')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle<{ storage_path: string; file_name: string }>()
  if (!att) return new NextResponse('Not found', { status: 404, headers: NO_STORE })

  const download = new URL(req.url).searchParams.get('download') === '1'
  const { data, error } = await auth.supabase.storage
    .from('attachments')
    .createSignedUrl(att.storage_path, 300, download ? { download: att.file_name } : undefined)
  if (error || !data) return new NextResponse('Not available', { status: 502, headers: NO_STORE })

  // The browser may reuse this redirect for a few minutes; the URL it points
  // at is good for five.
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=240' } })
}
