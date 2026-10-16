import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeState } from '../normalizeState'
import { loadStored, saveStored } from '../lightStorage'
import { lightById } from '../../lights'

const BIOTOPE = lightById('biotope')!
const NANO    = lightById('nano')!

// The 100P presets on robix as they were before this change.
const SIESTA = {
  sunrise: { startMinute: 345, durationMinutes: 15, steps: 3 },
  sunset:  { startMinute: 1020, durationMinutes: 15, steps: 3 },
  cycle:   { wrgbDuration: 40, spotlightDuration: 20, overlapMinutes: 2, cycleStart: 360, cycleEnd: 1020 },
  wrgbChannels: { r: 40, g: 40, b: 40, w: 50 },
  spotlightBrightness: 30, ppfdWrgb: 120, ppfdSpotlight: 80,
}

describe('normalizeState', () => {
  it('rejects siesta, with or without an explicit mode', () => {
    expect(normalizeState(BIOTOPE, SIESTA)).toBeNull()
    expect(normalizeState(BIOTOPE, { ...SIESTA, mode: 'siesta' })).toBeNull()
  })

  it("rejects the 100P's old two-field browser defaults", () => {
    expect(normalizeState(BIOTOPE, { wrgbChannels: { r: 40, g: 40, b: 40, w: 50 }, spotlightBrightness: 30 })).toBeNull()
  })

  it('rejects junk', () => {
    for (const v of [null, 42, 'x', [], {}, { ...NANO.defaults, peakStart: '09:00' },
                     { ...NANO.defaults, peakRgbw: { r: 1, g: 2, b: 3 } }, { ...NANO.defaults, stepMinutes: 0 }])
      expect(normalizeState(NANO, v)).toBeNull()
  })

  it('converts solid mode, deriving the step from the sunrise', () => {
    const solid = { ...SIESTA, mode: 'solid',
      sunrise: { startMinute: 360, durationMinutes: 20, steps: 4 },
      sunset:  { startMinute: 1000, durationMinutes: 20, steps: 4 },
      cycle:   { ...SIESTA.cycle, cycleStart: 380, cycleEnd: 1000 },
      wrgbChannels: { r: 50, g: 40, b: 30, w: 20 },
      spotlightBrightness: 25, spotlightLeadMinutes: 10, spotlightTailMinutes: 5 }
    expect(normalizeState(BIOTOPE, solid)).toEqual({
      rampUpStart: 360, peakStart: 380, peakEnd: 1000, rampDownEnd: 1020,
      peakRgbw: { r: 50, g: 40, b: 30, w: 20 }, stepMinutes: 5,
      spotlightBrightness: 25, spotlightLeadMinutes: 10, spotlightTailMinutes: 5,
    })
  })

  it('keeps a ramp state and drops keys it does not know', () => {
    expect(normalizeState(NANO, { ...NANO.defaults, mood: 'blue', ppfdWrgb: 9 })).toEqual(NANO.defaults)
  })

  it('gives spotlight fields only to a light with a spotlight', () => {
    const { spotlightBrightness, spotlightLeadMinutes, spotlightTailMinutes, ...bare } = BIOTOPE.defaults
    expect(normalizeState(BIOTOPE, bare)).toEqual(BIOTOPE.defaults)
    expect(normalizeState(NANO, { ...NANO.defaults, spotlightBrightness, spotlightLeadMinutes, spotlightTailMinutes }))
      .toEqual(NANO.defaults)
  })
})

describe('browser storage', () => {
  let store: Record<string, string>
  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
  })

  it('round-trips every 100P field', () => {
    const edited = { ...BIOTOPE.defaults, peakEnd: 800, spotlightTailMinutes: 20, peakRgbw: { r: 1, g: 2, b: 3, w: 4 } }
    saveStored(BIOTOPE, edited)
    expect(loadStored(BIOTOPE)).toEqual(edited)
  })

  it('discards and removes stored state that no longer fits', () => {
    store.aqualight_defaults = JSON.stringify({ wrgbChannels: { r: 40, g: 40, b: 40, w: 50 }, spotlightBrightness: 30 })
    expect(loadStored(BIOTOPE)).toBeNull()
    expect(store.aqualight_defaults).toBeUndefined()
  })
})
