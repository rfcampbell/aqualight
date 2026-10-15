/**
 * Debounced, coalescing sender for live preview. Each push restarts the delay;
 * when it lapses the latest value is sent, never more than one request in
 * flight. Values pushed during a send go out once it lands.
 */
export type LivePhase = 'pending' | 'sending' | 'applied' | 'error'
type Result = { ok: boolean; error?: string }

export function createLiveSender<T>(opts: {
  delayMs: number
  initial: T                                   // what the device already shows
  equal: (a: T, b: T) => boolean
  send: (next: T, prev: T) => Promise<Result>
  onPhase: (phase: LivePhase, error?: string) => void
  onPush?: () => void                          // a fresh delay just started
}) {
  let sent = opts.initial
  let latest: T | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inflight: Promise<void> | undefined
  let stopped = false

  function fire() {
    timer = undefined
    if (!inflight) inflight = flush().finally(() => { inflight = undefined })
  }

  async function flush() {
    let last: Result = { ok: true }
    // A value pushed mid-send waits out its own delay before going.
    while (latest !== undefined && !timer && !stopped) {
      const next = latest
      latest = undefined
      if (opts.equal(next, sent)) continue
      opts.onPhase('sending')
      try { last = await opts.send(next, sent) } catch (e) { last = { ok: false, error: String(e) } }
      if (last.ok) sent = next
    }
    if (stopped) return
    if (timer) opts.onPhase('pending')
    else       opts.onPhase(last.ok ? 'applied' : 'error', last.error)
  }

  return {
    push(v: T) {
      if (stopped) return
      latest = v
      if (timer) clearTimeout(timer)
      opts.onPhase('pending')
      opts.onPush?.()
      timer = setTimeout(fire, opts.delayMs)
    },
    /** Cancel anything pending and wait for a send already on the wire. */
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
      await inflight
    },
  }
}
