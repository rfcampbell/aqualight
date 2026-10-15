import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateYaml } from '../generateYaml'
import { switchMode, solidProblems, solidDliMinutes, modeOf } from '../solid'
import { LIGHTS } from '../../lights'
import type { ScheduleState, SiestaLight } from '../../types'
import { GOLDEN_TIME, NON_DEFAULT } from './golden/fixtures'

const BIOTOPE = LIGHTS.find(l => l.id === 'biotope') as SiestaLight
const SPOT    = BIOTOPE.spotlight!.entityId
const SOLID   = switchMode(BIOTOPE.defaults, 'solid', BIOTOPE)

const golden = (name: string) => readFileSync(new URL(`./golden/${name}.yaml`, import.meta.url), 'utf8')
const blocks = (yaml: string) => yaml.split('\n- id: ').slice(1)
const at     = (block: string) => block.match(/at: '(\d\d:\d\d:\d\d)'/)![1]

/** Every spotlight on/off in the file, in trigger order, as [time, ON|OFF]. */
function spotTransitions(yaml: string): [string, string][] {
  const out: [string, string][] = []
  for (const b of blocks(yaml)) {
    const m = b.match(new RegExp(`action: light\\.turn_(on|off)\\n\\s+target:\\n\\s+entity_id: ${SPOT.replace('.', '\\.')}`))
    if (m) out.push([at(b), m[1].toUpperCase()])
  }
  return out
}

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(GOLDEN_TIME) })
afterAll(() => vi.useRealTimers())

describe('solid mode output', () => {
  const yaml = generateYaml(SOLID, BIOTOPE)

  it('has no cycle or overlap automations', () => {
    const ids = blocks(yaml).map(b => b.slice(0, b.indexOf('\n')))
    expect(ids.filter(id => /cycle_|overlap|returns|joins/.test(id))).toEqual([])
    expect(yaml).not.toMatch(/Cycle \d|Overlap|Spotlight Joins|WRGB Returns/)
  })

  it('switches the spotlight exactly four times: 05:30 on, 06:15 off, 13:15 on, 14:00 off', () => {
    expect(spotTransitions(yaml)).toEqual([
      ['05:30:00', 'ON'], ['06:15:00', 'OFF'], ['13:15:00', 'ON'], ['14:00:00', 'OFF'],
    ])
  })

  it('brings WRGB to full at core start and leaves it alone until the sunset ramp', () => {
    const core = blocks(yaml).find(b => b.startsWith("'aquarium_core_on'"))!
    expect(at(core)).toBe('06:15:00')
    expect(core.match(/brightness_pct: 60/g)).toHaveLength(4)
    const wrgbOff = /entity_id: light\.dywpr120fa39f25d91a7_\w+/
    const between = blocks(yaml).filter(b => at(b) > '06:15:00' && at(b) < '13:15:00')
    expect(between.filter(b => wrgbOff.test(b))).toEqual([])
  })

  it('ramps in ten steps from 05:45 and down in ten from 13:15', () => {
    expect(blocks(yaml).filter(b => b.startsWith("'aquarium_sunrise_step_"))).toHaveLength(10)
    expect(blocks(yaml).filter(b => b.startsWith("'aquarium_sunset_step_"))).toHaveLength(10)
    expect(at(blocks(yaml).find(b => b.startsWith("'aquarium_sunrise_step_1'"))!)).toBe('05:45:00')
    expect(at(blocks(yaml).find(b => b.startsWith("'aquarium_sunset_step_1'"))!)).toBe('13:15:00')
  })

  it('turns everything off at the end of the spotlight tail', () => {
    const off = blocks(yaml).find(b => b.startsWith("'aquarium_lights_off'"))!
    expect(at(off)).toBe('14:00:00')
    expect(yaml).toContain('#               Off at 14:00:00')
  })
})

describe('solid mode validation', () => {
  it('accepts the 100P solid defaults', () => {
    expect(solidProblems(SOLID)).toEqual([])
  })

  it('rejects a sunrise that runs past core start', () => {
    const s = { ...SOLID, sunrise: { ...SOLID.sunrise, durationMinutes: 45 } }  // ends 06:30
    expect(solidProblems(s)).toEqual(['Sunrise ends at 06:30, after core start 06:15.'])
  })

  it('rejects a sunset that starts before core end', () => {
    const s = { ...SOLID, sunset: { ...SOLID.sunset, startMinute: 780 } }        // 13:00
    expect(solidProblems(s)).toEqual(['Sunset starts at 13:00, before core end 13:15.'])
  })

  it('never blocks a siesta schedule, whatever its ramps do', () => {
    const s = { ...BIOTOPE.defaults, sunrise: { ...BIOTOPE.defaults.sunrise, durationMinutes: 60 } }
    expect(solidProblems(s)).toEqual([])
  })
})

describe('siesta parity with the pre-solid generator', () => {
  const cases: [string, ScheduleState, SiestaLight][] = [
    ['siesta-default',              BIOTOPE.defaults, BIOTOPE],
    ['siesta-non-default',          NON_DEFAULT,      BIOTOPE],
    ['siesta-non-default-mqtt',     NON_DEFAULT,
      { ...BIOTOPE, transport: { kind: 'mqtt', entityId: 'light.chihiros_wrgb', topic: 'chihiros/light/set' } }],
  ]

  it.each(cases)('%s is byte-identical with mode absent', (name, state, light) => {
    expect(generateYaml(state, light)).toBe(golden(name))
  })

  it.each(cases)('%s is byte-identical with mode: siesta', (name, state, light) => {
    expect(generateYaml({ ...state, mode: 'siesta' }, light)).toBe(golden(name))
  })

  it('a round trip through solid and back restores the siesta defaults exactly', () => {
    const back = switchMode(SOLID, 'siesta', BIOTOPE)
    expect(generateYaml(back, BIOTOPE)).toBe(golden('siesta-default'))
  })

  it('loads state and presets saved before solid mode as siesta', () => {
    const legacy = { wrgbChannels: { r: 1, g: 2, b: 3, w: 4 }, spotlightBrightness: 9 }
    expect(modeOf({ ...BIOTOPE.defaults, ...legacy })).toBe('siesta')
  })
})

describe('solid mode DLI', () => {
  it('counts ramp steps at their own levels, the core in full, and both spotlight windows', () => {
    // Sunrise: 3-min steps at 1/10..9/10 = 13.5; core 06:12→13:15 = 423;
    // sunset: 9/10..0/10 = 13.5. Spotlight 45 + 45.
    expect(solidDliMinutes(SOLID)).toEqual({ wrgbMinutes: 450, spotlightMinutes: 90 })
  })
})
