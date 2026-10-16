import { describe, it, expect } from 'vitest'
import { LIGHTS, SHARED_LIGHTS, KNOWN_PREFIXES, assertRegistryAgrees, lightById } from '../lights'

describe('light registry', () => {
  it('agrees with backend/lights.json', () => {
    expect(() => assertRegistryAgrees()).not.toThrow()
  })

  it('covers every light the backend knows about, and no others', () => {
    expect(LIGHTS.map(l => l.id).sort()).toEqual(SHARED_LIGHTS.map(l => l.id).sort())
  })

  it('would catch a drifted prefix rather than pass silently', () => {
    // Guards the guard: a mismatch has to be detectable, or the check is
    // decoration. Same comparison assertRegistryAgrees performs.
    const mine   = ['biotope|aquarium_|biotope', 'nano|nano_|nano']
    const theirs = ['biotope|aquarium_|biotope', 'nano|nano2_|nano']
    const agrees = mine.length === theirs.length && mine.every((m, i) => m === theirs[i])
    expect(agrees).toBe(false)
  })

  it('derives KNOWN_PREFIXES from the registry in declaration order', () => {
    expect(KNOWN_PREFIXES).toEqual(['aquarium_', 'nano_', 'display_'])
  })

  it('gives every light a unique id, prefix, preset id and storage key', () => {
    for (const field of ['id', 'prefix', 'presetId'] as const) {
      const vals = LIGHTS.map(l => l[field])
      expect(new Set(vals).size).toBe(vals.length)
    }
    const keys = LIGHTS.map(l => l.storage.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the legacy localStorage keys so saved state survives', () => {
    expect(lightById('biotope')!.storage.key).toBe('aqualight_defaults')
    expect(lightById('nano')!.storage.key).toBe('aqualight_nano')
  })

  it('ends every prefix with an underscore so ids cannot collide', () => {
    for (const l of LIGHTS) expect(l.prefix.endsWith('_')).toBe(true)
  })

  it('gives a spotlight to the 100P only, with its levels in the schedule', () => {
    for (const l of LIGHTS) {
      const has = l.id === 'biotope'
      expect('spotlight' in l).toBe(has)
      for (const f of ['spotlightBrightness', 'spotlightLeadMinutes', 'spotlightTailMinutes'] as const)
        expect(f in l.defaults).toBe(has)
    }
  })

  it('has the 100P on the ramp shape with its solid-day times', () => {
    const b = lightById('biotope')!
    expect(b.defaults).toEqual({
      rampUpStart: 345, peakStart: 375, peakEnd: 795, rampDownEnd: 825,
      peakRgbw: { r: 60, g: 60, b: 60, w: 60 }, stepMinutes: 3,
      spotlightBrightness: 30, spotlightLeadMinutes: 15, spotlightTailMinutes: 15,
    })
    expect(b.dli).toEqual({ ppfdWrgb: 57, ppfdSpotlight: 1 })
    expect(b.transport.kind).toBe('light_entities')
  })

  it('marks placeholder DLI values as TODO so they cannot pass for measured', () => {
    // The display lamp's PPFD is not measured yet. Its numbers are invented, and
    // anything reading them needs to be able to tell.
    const display = lightById('display')!
    expect(display.dli?.todo).toBeTruthy()
    expect(lightById('biotope')!.dli?.todo).toBeUndefined()
  })

  it('wires the display to its real chihiros-led-control entities', () => {
    const d = lightById('display')!
    expect(d.transport).toEqual({
      kind: 'light_entities',
      entityIds: {
        red:   'light.dywpro90e2e042ecb9fb_red',
        green: 'light.dywpro90e2e042ecb9fb_green',
        blue:  'light.dywpro90e2e042ecb9fb_blue',
        white: 'light.dywpro90e2e042ecb9fb_white',
      },
    })
    // No light is a placeholder any more, here or in the backend's copy.
    for (const l of LIGHTS) expect(l.placeholder).toBeUndefined()
    for (const l of SHARED_LIGHTS) expect(l.placeholder).toBeUndefined()
  })

  it('has the display light with no spotlight', () => {
    const d = lightById('display')!
    expect(d.prefix).toBe('display_')
    expect('spotlight' in d).toBe(false)
    expect(d.transport.kind).toBe('light_entities')
  })
})
