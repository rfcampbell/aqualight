import type { Light } from './types'

/** POST to the backend's generic HA light caller. brightness_pct 0 turns the entity off. */
export async function callTestLight(entityId: string, state: 'ON' | 'OFF', brightnessPct?: number) {
  const res = await fetch('/api/test/light', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id: entityId, state, brightness_pct: brightnessPct }),
  })
  return res.json() as Promise<{ ok: boolean; error?: string }>
}

type Result = { ok: boolean; error?: string }
type Rgbw = { r: number; g: number; b: number; w: number }

/** Send a ramp light's device test over whatever transport it actually uses. */
export async function sendRampTest(
  light: Light, rgbw: Rgbw, on: boolean,
  prev?: Rgbw,   // what the lamp already shows; per-channel lights then skip unchanged channels
): Promise<Result> {
  const { r, g, b, w } = rgbw
  const t = light.transport
  switch (t.kind) {
    case 'mqtt': {
      const body = on ? { state: 'ON', r, g, b, w } : { state: 'OFF' }
      const res  = await fetch(light.mqttTestEndpoint ?? '/api/test/nano', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.json()
    }
    case 'ha_light':
      return callTestLight(t.entityId, on ? 'ON' : 'OFF', on ? 100 : undefined)
    case 'light_entities': {
      const { red, green, blue, white } = t.entityIds
      const ids = { r: red, g: green, b: blue, w: white }
      const chans = (['r', 'g', 'b', 'w'] as const).filter(c => !on || !prev || prev[c] !== rgbw[c])
      const results = await Promise.all(chans.map(c =>
        on ? callTestLight(ids[c], 'ON', rgbw[c]) : callTestLight(ids[c], 'OFF')))
      return results.find(x => !x.ok) ?? { ok: true }
    }
  }
}
