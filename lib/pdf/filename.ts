// GL-A1_3453-Hoover-Rd_2026-09-23.pdf: code, label, date (Eastern).
export function pdfFileName(code: string, label: string, now = new Date()) {
  const slug =
    label
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'list'
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return `${code}_${slug}_${date}.pdf`
}
