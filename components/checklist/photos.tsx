'use client'

import { useRef, useState } from 'react'
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, SHOWS_INLINE, cleanFileName, fmtBytes, type Attachment } from '@/lib/attachments'
import { fmtWhen } from '@/lib/format'
import { deleteAttachment, finishUpload, startUpload } from '@/app/(app)/l/[id]/photo-actions'

type Upload = { key: number; name: string; pct: number; error?: string }

// PUT the file to the signed Storage URL, the same way supabase-js's
// uploadToSignedUrl does, but with XHR so we can show progress on a phone.
function put(url: string, file: File, onPct: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('network'))
    const body = new FormData()
    body.append('cacheControl', '3600')
    body.append('', file)
    xhr.send(body)
  })
}

export function Photos({
  instanceId,
  initial,
  canDelete,
  style,
}: {
  instanceId: string
  initial: Attachment[]
  canDelete: boolean
  style?: React.CSSProperties
}) {
  const [items, setItems] = useState(initial)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const patch = (key: number, u: Partial<Upload>) =>
    setUploads((cur) => cur.map((x) => (x.key === key ? { ...x, ...u } : x)))

  const addFiles = async (files: File[]) => {
    setError(null)
    // One at a time: kinder to a phone on a weak signal.
    for (const file of files) {
      const key = ++seq.current
      const name = cleanFileName(file.name)
      setUploads((cur) => [...cur, { key, name, pct: 0 }])
      if (!ATTACHMENT_TYPES[file.type]) {
        patch(key, { error: 'Only photos (JPEG, PNG, WebP, HEIC) and PDFs can be added.' })
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        patch(key, { error: 'Over 25 MB.' })
        continue
      }
      try {
        const start = await startUpload(instanceId, { name: file.name, type: file.type, size: file.size })
        if (!start.ok) {
          patch(key, { error: start.error })
          continue
        }
        await put(start.url, file, (pct) => patch(key, { pct }))
        const done = await finishUpload(instanceId, start.path, file.name)
        if (!done.ok) {
          patch(key, { error: done.error })
          continue
        }
        setItems((cur) => [...cur, done.attachment])
        setUploads((cur) => cur.filter((x) => x.key !== key))
      } catch {
        patch(key, { error: 'The upload did not go through. Check the connection and try again.' })
      }
    }
  }

  const remove = async (a: Attachment) => {
    if (!window.confirm(`Delete "${a.file_name}"? It is kept in the delete log.`)) return
    const res = await deleteAttachment(a.id)
    if (!res.ok) return setError(res.error)
    setItems((cur) => cur.filter((x) => x.id !== a.id))
  }

  return (
    <section className="photos noprint" aria-labelledby="photos-h" style={style}>
      <div className="photohead">
        <h3 id="photos-h">
          Photos and documents <span className="mono">{items.length || ''}</span>
        </h3>
        <label className="btn primary">
          Add photos
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              void addFiles(files)
            }}
          />
        </label>
      </div>
      <p className="tblnote">JPEG, PNG, WebP, HEIC or PDF, up to 25 MB each. They stay with this list only.</p>

      {uploads.map((u) => (
        <div key={u.key} className="upl" role={u.error ? 'alert' : 'status'}>
          <span className="nm">{u.name}</span>
          {u.error ? (
            <>
              <span className="err">{u.error}</span>
              <button
                className="linkbtn"
                type="button"
                onClick={() => setUploads((cur) => cur.filter((x) => x.key !== u.key))}
              >
                Dismiss
              </button>
            </>
          ) : (
            <progress max={100} value={u.pct} aria-label={`Uploading ${u.name}`} />
          )}
        </div>
      ))}
      {error ? (
        <p className="formerr" role="alert">
          {error}
        </p>
      ) : null}

      {items.length ? (
        <ul className="photogrid">
          {items.map((a) => (
            <li key={a.id}>
              <a className="thumb" href={`/files/${a.id}`} target="_blank" rel="noopener">
                {SHOWS_INLINE.has(a.mime_type) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, signed, redirecting URL
                  <img src={`/files/${a.id}`} alt={a.file_name} loading="lazy" decoding="async" />
                ) : (
                  <span className="filetile">{a.mime_type === 'application/pdf' ? 'PDF' : 'HEIC'}</span>
                )}
              </a>
              <div className="cap">
                <b>{a.file_name}</b>
                <span>
                  {a.uploaded_by}, {fmtWhen(a.uploaded_at)}
                </span>
                <span className="acts">
                  <a href={`/files/${a.id}?download=1`}>Download</a>
                  <span>{fmtBytes(a.size_bytes)}</span>
                  {canDelete ? (
                    <button className="linkbtn" type="button" onClick={() => void remove(a)}>
                      Delete
                    </button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tblnote" style={{ marginTop: 10 }}>
          No photos yet.
        </p>
      )}
    </section>
  )
}
