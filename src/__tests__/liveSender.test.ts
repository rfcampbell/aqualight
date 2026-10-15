import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLiveSender, type LivePhase } from '../liveSender'

type Res = { ok: boolean; error?: string }

function harness(reply: (v: number) => Res = () => ({ ok: true })) {
  const sent: { next: number; prev: number }[] = []
  const phases: LivePhase[] = []
  let concurrent = 0, maxConcurrent = 0
  const pending: (() => void)[] = []
  const sender = createLiveSender<number>({
    delayMs: 300,
    initial: 0,
    equal: (a, b) => a === b,
    send: (next, prev) => {
      sent.push({ next, prev })
      maxConcurrent = Math.max(maxConcurrent, ++concurrent)
      return new Promise<Res>(resolve => pending.push(() => { concurrent--; resolve(reply(next)) }))
    },
    onPhase: p => phases.push(p),
  })
  // Resolve the oldest in-flight send and let its continuation run.
  const land = async () => { pending.shift()!(); await vi.advanceTimersByTimeAsync(0) }
  return { sender, sent, phases, land, maxConcurrent: () => maxConcurrent }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('live sender', () => {
  it('sends only the last value, once the slider has been still for the delay', async () => {
    const h = harness()
    h.sender.push(10)
    await vi.advanceTimersByTimeAsync(200)
    h.sender.push(20)
    await vi.advanceTimersByTimeAsync(200)
    h.sender.push(30)
    await vi.advanceTimersByTimeAsync(299)
    expect(h.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(h.sent).toEqual([{ next: 30, prev: 0 }])
    await h.land()
    expect(h.phases.at(-1)).toBe('applied')
  })

  it('never has two sends on the wire; a mid-send change waits its own delay', async () => {
    const h = harness()
    h.sender.push(10)
    await vi.advanceTimersByTimeAsync(300)
    h.sender.push(20)                         // while 10 is in flight
    await vi.advanceTimersByTimeAsync(300)    // its delay lapses, 10 still in flight
    expect(h.sent).toHaveLength(1)
    await h.land()                            // 10 lands, 20 goes straight out
    expect(h.sent).toEqual([{ next: 10, prev: 0 }, { next: 20, prev: 10 }])
    await h.land()
    expect(h.maxConcurrent()).toBe(1)
    expect(h.phases.at(-1)).toBe('applied')
  })

  it('reports pending, not applied, when a send lands while a newer value settles', async () => {
    const h = harness()
    h.sender.push(10)
    await vi.advanceTimersByTimeAsync(300)
    h.sender.push(20)
    await vi.advanceTimersByTimeAsync(100)
    await h.land()
    expect(h.phases.at(-1)).toBe('pending')
  })

  it('reports a failure and keeps it, and diffs the retry against what last landed', async () => {
    const h = harness(v => v === 10 ? { ok: false, error: 'ble timeout' } : { ok: true })
    h.sender.push(10)
    await vi.advanceTimersByTimeAsync(300)
    await h.land()
    expect(h.phases.at(-1)).toBe('error')
    h.sender.push(20)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent.at(-1)).toEqual({ next: 20, prev: 0 })
  })

  it('skips a value the lamp already shows', async () => {
    const h = harness()
    h.sender.push(5)
    h.sender.push(0)                          // dragged back to where it started
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent).toEqual([])
    expect(h.phases.at(-1)).toBe('applied')
  })

  it('stop cancels a pending value and waits for the one on the wire', async () => {
    const h = harness()
    h.sender.push(10)
    await vi.advanceTimersByTimeAsync(300)
    h.sender.push(20)
    let stopped = false
    const stopping = h.sender.stop().then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toBe(false)               // 10 still in flight: Off must not overtake it
    await h.land()
    await stopping
    expect(stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.sent).toEqual([{ next: 10, prev: 0 }])
  })
})
