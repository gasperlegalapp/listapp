import { saveField, type SaveResult } from '@/app/(app)/l/[id]/actions'
import type { Value } from '@/lib/templates/values'

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; msg: string }
  | { kind: 'signedout' }

// Field-level autosave. Each field saves on its own, so two people editing
// different fields never overwrite each other. One request per field at a
// time, so an older value can never land after a newer one. Failed saves keep
// the value and retry with backoff; nothing typed is ever dropped.
export class SaveQueue {
  private pending = new Map<string, Value | null>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = new Set<string>()
  private retryMs = 3000

  constructor(
    private instanceId: string,
    private onStatus: (s: SaveStatus) => void,
  ) {}

  busy() {
    return this.pending.size > 0 || this.inflight.size > 0
  }

  isDirty(key: string) {
    return this.pending.has(key) || this.inflight.has(key)
  }

  queue(key: string, value: Value | null, delayMs: number) {
    this.pending.set(key, value)
    this.onStatus({ kind: 'saving' })
    this.schedule(key, delayMs)
  }

  private schedule(key: string, delayMs: number) {
    const t = this.timers.get(key)
    if (t) clearTimeout(t)
    this.timers.set(
      key,
      setTimeout(() => void this.flush(key), delayMs),
    )
  }

  async flush(key: string): Promise<void> {
    const t = this.timers.get(key)
    if (t) clearTimeout(t)
    this.timers.delete(key)
    if (!this.pending.has(key) || this.inflight.has(key)) return
    const value = this.pending.get(key) ?? null
    this.pending.delete(key)
    this.inflight.add(key)
    this.onStatus({ kind: 'saving' })
    let res: SaveResult
    try {
      res = await saveField(this.instanceId, key, value)
    } catch {
      res = { ok: false, error: 'We could not reach the server.' }
    }
    this.inflight.delete(key)
    if (res.ok) {
      this.retryMs = 3000
      if (this.pending.has(key)) return this.flush(key)
      if (!this.busy()) this.onStatus({ kind: 'saved', at: new Date() })
      return
    }
    if (!this.pending.has(key)) this.pending.set(key, value)
    this.onStatus(res.signedOut ? { kind: 'signedout' } : { kind: 'error', msg: res.error })
    const d = this.retryMs
    this.retryMs = Math.min(d * 2, 60000)
    this.schedule(key, d)
  }
}
