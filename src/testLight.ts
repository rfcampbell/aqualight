import type { RampLight } from './types'

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

/** Send a ramp light's device test over whatever transport it actually uses. */
export async function sendRampTest(
  light: RampLight, rgbw: { r: number; g: number; b: number; w: number }, on: boolean,
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
      const results = await Promise.all(on
        ? [callTestLight(red, 'ON', r), callTestLight(green, 'ON', g),
           callTestLight(blue, 'ON', b), callTestLight(white, 'ON', w)]
        : [red, green, blue, white].map(id => callTestLight(id, 'OFF')))
      return results.find(x => !x.ok) ?? { ok: true }
    }
  }
}
