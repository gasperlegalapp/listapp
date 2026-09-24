// Static HTML from React elements, for the PDF.
//
// Next.js does not allow react-dom/server in route handlers, and the PDF is a
// route handler. The sheet is plain markup (no hooks, no context, no
// handlers in static mode), so this walks the element tree directly. It
// covers exactly what components/checklist/sheet.tsx uses and throws on
// anything else. tests/unit/static-markup.test.ts checks it produces the
// same string as react-dom/server's renderToStaticMarkup for every template.

import type { ReactNode } from 'react'

const ELEMENT = Symbol.for('react.transitional.element')
const LEGACY_ELEMENT = Symbol.for('react.element')
const FRAGMENT = Symbol.for('react.fragment')

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const ATTR_NAME: Record<string, string> = { className: 'class', htmlFor: 'for' }
const BOOLEAN = new Set(['readOnly', 'checked', 'disabled', 'required', 'multiple', 'hidden', 'selected'])
const SKIP = new Set(['children', 'key', 'ref', 'dangerouslySetInnerHTML', 'suppressHydrationWarning'])
const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'opacity', 'order', 'zIndex', 'zoom'])

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]!)
}

function styleText(style: Record<string, unknown>) {
  const parts: string[] = []
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === '' || typeof v === 'boolean') continue
    const custom = k.startsWith('--')
    const name = custom ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    const val = typeof v === 'number' && v !== 0 && !custom && !UNITLESS.has(k) ? `${v}px` : String(v)
    parts.push(`${name}:${val.trim()}`)
  }
  return parts.join(';')
}

type El = { $$typeof: symbol; type: unknown; props: Record<string, unknown> }

function isElement(n: unknown): n is El {
  return typeof n === 'object' && n !== null && ((n as El).$$typeof === ELEMENT || (n as El).$$typeof === LEGACY_ELEMENT)
}

export function renderStatic(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return escapeHtml(node)
  if (typeof node === 'number' || typeof node === 'bigint') return escapeHtml(String(node))
  if (Array.isArray(node)) return node.map(renderStatic).join('')
  if (!isElement(node)) throw new Error(`renderStatic: unsupported node ${String(node)}`)

  const { type, props } = node
  if (type === FRAGMENT) return renderStatic(props.children as ReactNode)
  if (typeof type === 'function') {
    if (type.prototype?.isReactComponent) throw new Error('renderStatic: class components are not supported')
    return renderStatic((type as (p: unknown) => ReactNode)(props))
  }
  if (typeof type !== 'string') throw new Error('renderStatic: unsupported element type')
  if (props.dangerouslySetInnerHTML) throw new Error('renderStatic: dangerouslySetInnerHTML is not allowed')

  const tag = type
  let attrs = ''
  let content: string | null = null
  // Like React, an input's checked and value go last, whatever the prop order.
  let checked: boolean | null = null
  let value: string | null = null
  for (const [k, v] of Object.entries(props)) {
    if (SKIP.has(k) || /^on[A-Z]/.test(k) || v == null || typeof v === 'function') continue
    if (tag === 'textarea' && (k === 'value' || k === 'defaultValue')) {
      content = String(v)
      continue
    }
    if (tag === 'input' && (k === 'checked' || k === 'defaultChecked')) {
      if (k === 'checked' || checked === null) checked = v === true
      continue
    }
    if (tag === 'input' && (k === 'value' || k === 'defaultValue')) {
      if (k === 'value' || value === null) value = String(v)
      continue
    }
    if (k === 'style') {
      const css = styleText(v as Record<string, unknown>)
      if (css) attrs += ` style="${escapeHtml(css)}"`
      continue
    }
    const name = ATTR_NAME[k] ?? k
    if (BOOLEAN.has(k)) {
      if (v === true) attrs += ` ${name}=""`
      continue
    }
    if (typeof v === 'boolean') {
      if (k.startsWith('aria-') || k.startsWith('data-')) attrs += ` ${name}="${v}"`
      continue
    }
    attrs += ` ${name}="${escapeHtml(String(v))}"`
  }

  if (checked) attrs += ' checked=""'
  if (value !== null) attrs += ` value="${escapeHtml(value)}"`

  if (VOID.has(tag)) return `<${tag}${attrs}/>`
  if (tag === 'textarea') {
    const text = content ?? ''
    return `<textarea${attrs}>${text.startsWith('\n') ? '\n' : ''}${escapeHtml(text)}</textarea>`
  }
  return `<${tag}${attrs}>${renderStatic(props.children as ReactNode)}</${tag}>`
}
