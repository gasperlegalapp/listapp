// Template guidance notes may contain <b> tags and nothing else (the import
// script enforces this). Render them as React nodes; never as raw HTML.
export function NoteHtml({ html, className }: { html: string; className: string }) {
  const parts = html.split(/(<b>|<\/b>)/)
  const out: React.ReactNode[] = []
  let bold = false
  parts.forEach((part, i) => {
    if (part === '<b>') bold = true
    else if (part === '</b>') bold = false
    else if (part) out.push(bold ? <b key={i}>{part}</b> : part)
  })
  return <div className={className}>{out}</div>
}
