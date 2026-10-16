import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateRampYaml } from '../generateYaml'
import { LIGHTS, lightById } from '../../lights'
import type { RampScheduleState, LightConfig, Light } from '../../types'

const BIOTOPE = lightById('biotope')!
const NANO    = lightById('nano')!

function withTransport(light: Light, transport: LightConfig): Light {
  return { ...light, transport }
}

const golden = (name: string) => readFileSync(new URL(`./golden/${name}.yaml`, import.meta.url), 'utf8')
const blocks = (yaml: string) => yaml.split('\n- id: ').slice(1)
const block  = (yaml: string, id: string) => blocks(yaml).find(b => b.startsWith(`'${id}'`))!

// Same instant the goldens were generated at, so the header's timestamp matches.
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')) })
afterAll(() => vi.useRealTimers())

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NANO_SCHEDULE: RampScheduleState = {
  rampUpStart:  420,
  peakStart:    480,
  peakEnd:      1080,
  rampDownEnd:  1140,
  peakRgbw:     { r: 40, g: 40, b: 45, w: 55 },
  stepMinutes:  30,
}

// ── Lights without a spotlight are unchanged by spotlight support ─────────────

describe('ramp output frozen before spotlight support', () => {
  // Written by generateNanoYaml at f453749, before the spotlight existed.
  it.each(['nano', 'display'])('%s defaults match byte for byte', id => {
    const l = lightById(id)!
    expect(generateRampYaml(l.defaults, l)).toBe(golden(`ramp-${id}-default`))
  })

  it('a non-default nano schedule matches byte for byte', () => {
    expect(generateRampYaml(
      { rampUpStart: 400, peakStart: 470, peakEnd: 1065, rampDownEnd: 1130,
        peakRgbw: { r: 55, g: 0, b: 35, w: 70 }, stepMinutes: 7 }, NANO,
    )).toBe(golden('ramp-nano-non-default'))
  })
})

// ── 100P: four channel entities plus the spotlight ────────────────────────────

describe('100P output', () => {
  const yaml = generateRampYaml(BIOTOPE.defaults, BIOTOPE)
  const SPOT = BIOTOPE.spotlight!.entityId

  it('has no siesta automations', () => {
    expect(yaml).not.toMatch(/cycle_|overlap|returns|joins|sunrise_step|sunset_step|core_on/)
  })

  it('every id is owned by the aquarium_ prefix', () => {
    for (const b of blocks(yaml)) expect(b.startsWith("'aquarium_")).toBe(true)
  })

  it('emits triggers in time order', () => {
    const times = blocks(yaml).map(b => b.match(/at: '([\d:]+)'/)![1])
    expect(times).toEqual([...times].sort())
  })

  it('switches the spotlight four times at 30%: 05:30 on, 06:15 off, 13:15 on, 14:00 off', () => {
    const spot = blocks(yaml)
      .filter(b => b.includes(`entity_id: ${SPOT}`))
      .map(b => [b.match(/at: '([\d:]+)'/)![1], b.includes('turn_on') ? 'on' : 'off'])
    expect(spot).toEqual([['05:30:00', 'on'], ['06:15:00', 'off'], ['13:15:00', 'on'], ['14:00:00', 'off']])
    expect(block(yaml, 'aquarium_spotlight_dawn_on')).toContain('brightness_pct: 30')
    expect(block(yaml, 'aquarium_spotlight_dusk_on')).toContain('brightness_pct: 30')
  })

  it('emits four light.turn_on actions per WRGB step, in R/G/B/W order', () => {
    const b = block(yaml, 'aquarium_ramp_up_0615')
    expect((b.match(/action: light\.turn_on/g) ?? []).length).toBe(4)
    expect(b.match(/brightness_pct: (\d+)/g)).toEqual(Array(4).fill('brightness_pct: 60'))
    const order = ['_red', '_green', '_blue', '_white'].map(c => b.indexOf(c))
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })

  it('channel value of 0 → light.turn_off on that channel', () => {
    const y = generateRampYaml({ ...BIOTOPE.defaults, peakRgbw: { r: 40, g: 40, b: 40, w: 0 } }, BIOTOPE)
    const b = block(y, 'aquarium_ramp_up_0615')
    expect((b.match(/action: light\.turn_on/g) ?? []).length).toBe(3)
    expect(b).toMatch(/action: light\.turn_off\s+target:\s+entity_id: light\.dywpr120fa39f25d91a7_white/)
  })

  it('ends the ramp with all four channels off', () => {
    const b = block(yaml, 'aquarium_ramp_down_1345')
    expect((b.match(/action: light\.turn_off/g) ?? []).length).toBe(4)
  })

  it('header names the spotlight and its windows', () => {
    expect(yaml).toContain(`# Spotlight  : ${SPOT} at 30%`)
    expect(yaml).toContain('# Spotlight  : 05:30 – 06:15 and 13:15 – 14:00')
  })

  it('follows lead, tail and brightness edits', () => {
    const y = generateRampYaml({ ...BIOTOPE.defaults, spotlightLeadMinutes: 0, spotlightTailMinutes: 30, spotlightBrightness: 45 }, BIOTOPE)
    expect(block(y, 'aquarium_spotlight_dawn_on')).toContain("at: '05:45:00'")
    expect(block(y, 'aquarium_spotlight_dusk_off')).toContain("at: '14:15:00'")
    expect(block(y, 'aquarium_spotlight_dusk_on')).toContain('brightness_pct: 45')
  })
})

// ── Transports ────────────────────────────────────────────────────────────────

describe('mqtt transport', () => {
  const yaml = generateRampYaml(NANO_SCHEDULE, NANO)

  it('emits service: mqtt.publish on the nano topic', () => {
    expect(yaml).toContain('service: mqtt.publish')
    expect(yaml).toContain('topic: chihiros/nano/light/set')
    expect(yaml).not.toContain('action: light.turn_on')
  })

  it('peak payload has 0-100 channel values', () => {
    expect(yaml).toContain('"red":40,"green":40,"blue":45,"white":55')
  })

  it('OFF payload is {"state":"OFF"}', () => {
    expect(yaml).toContain('{"state":"OFF"}')
  })

  it('header mentions the MQTT topic', () => {
    expect(yaml).toContain('MQTT topic chihiros/nano/light/set')
  })
})

describe('ha_light transport', () => {
  const cfg: LightConfig = { kind: 'ha_light', entityId: 'light.chihiros_nano_wrgb' }
  const yaml = generateRampYaml(NANO_SCHEDULE, withTransport(NANO, cfg))

  it('turns on with rgbw_color on the 0-255 scale and off at the end', () => {
    expect(yaml).toContain('rgbw_color: [102, 102, 115, 140]')
    expect(yaml).toContain('action: light.turn_off')
    expect(yaml).not.toContain('mqtt.publish')
  })

  it('header mentions the HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_nano_wrgb')
  })
})

describe('registry transports', () => {
  it('100P uses the four chihiros-led-control entities', () => {
    expect(BIOTOPE.transport).toEqual({
      kind: 'light_entities',
      entityIds: {
        red:   'light.dywpr120fa39f25d91a7_red',
        green: 'light.dywpr120fa39f25d91a7_green',
        blue:  'light.dywpr120fa39f25d91a7_blue',
        white: 'light.dywpr120fa39f25d91a7_white',
      },
    })
  })

  it('nano uses mqtt', () => {
    expect(NANO.transport).toEqual({ kind: 'mqtt', entityId: 'light.chihiros_nano_wrgb', topic: 'chihiros/nano/light/set' })
  })

  it('every light generates without throwing', () => {
    for (const l of LIGHTS) expect(generateRampYaml(l.defaults, l)).toContain(`- id: '${l.prefix}`)
  })
})
