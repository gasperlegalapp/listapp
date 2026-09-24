import Link from 'next/link'

export default function NotFound() {
  return (
    <>
      <div className="pagehead">
        <div className="eyebrow">Not found</div>
        <h2>We could not find that</h2>
        <p className="sub">
          It may have been deleted, the link may be incomplete, or it belongs to something you do not have access to.
        </p>
      </div>
      <p>
        <Link href="/">Back to matters</Link>
      </p>
    </>
  )
}
