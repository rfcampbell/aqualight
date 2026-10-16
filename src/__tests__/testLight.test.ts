import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendRampTest } from '../testLight'
import { lightById } from '../lights'

const RGBW = { r: 10, g: 0, b: 30, w: 40 }

function stubFetch(reply: (url: string, body: Record<string, unknown>) => object = () => ({ ok: true })) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    calls.push({ url, body })
    return { json: async () => reply(url, body) }
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('ramp device test', () => {
  it('drives the display per channel through HA, never the nano over MQTT', async () => {
    const calls = stubFetch()
    const res = await sendRampTest(lightById('display')!, RGBW, true)
    expect(res.ok).toBe(true)
    expect(calls.every(c => c.url === '/api/test/light')).toBe(true)
    expect(calls.map(c => c.body).sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id)))).toEqual([
      { entity_id: 'light.dywpro90e2e042ecb9fb_blue',  state: 'ON', brightness_pct: 30 },
      { entity_id: 'light.dywpro90e2e042ecb9fb_green', state: 'ON', brightness_pct: 0 },
      { entity_id: 'light.dywpro90e2e042ecb9fb_red',   state: 'ON', brightness_pct: 10 },
      { entity_id: 'light.dywpro90e2e042ecb9fb_white', state: 'ON', brightness_pct: 40 },
    ])
  })

  it('turns every display channel off', async () => {
    const calls = stubFetch()
    await sendRampTest(lightById('display')!, RGBW, false)
    expect(calls).toHaveLength(4)
    expect(calls.every(c => c.url === '/api/test/light' && c.body.state === 'OFF')).toBe(true)
  })

  it('reports the first failing channel', async () => {
    stubFetch((_, body) => String(body.entity_id).endsWith('_green')
      ? { ok: false, error: 'green unreachable' } : { ok: true })
    const res = await sendRampTest(lightById('display')!, RGBW, true)
    expect(res).toEqual({ ok: false, error: 'green unreachable' })
  })

  it('leaves the nano on its MQTT endpoint', async () => {
    const calls = stubFetch()
    await sendRampTest(lightById('nano')!, RGBW, true)
    expect(calls).toEqual([{ url: '/api/test/nano', body: { state: 'ON', ...RGBW } }])
  })
})

describe('ramp device test, live diffs', () => {
  it('sends only the channels that changed on a per-channel light', async () => {
    const calls = stubFetch()
    await sendRampTest(lightById('display')!, { ...RGBW, b: 55 }, true, RGBW)
    expect(calls).toEqual([{ url: '/api/test/light',
      body: { entity_id: 'light.dywpro90e2e042ecb9fb_blue', state: 'ON', brightness_pct: 55 } }])
  })
})
