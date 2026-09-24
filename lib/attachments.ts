// Photos and documents attached to a list. Shared by the server actions, the
// list page and the upload widget, so it must stay free of server-only code.

// Must match the "attachments" bucket's allowed_mime_types and size limit
// (supabase/migrations/20260923000400_storage.sql).
export const ATTACHMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Browsers other than Safari cannot show HEIC, so those get a file tile.
export const SHOWS_INLINE = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type Attachment = {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
  uploaded_by: string
}

// ASCII, no path separators or control characters, at most 120 characters.
export function cleanFileName(name: unknown) {
  const s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(-120)
  return s || 'file'
}

export function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
