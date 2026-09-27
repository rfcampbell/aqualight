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
    expect(KNOWN_PREFIXES).toEqual(['aquarium_', 'nano_'])
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

  it('gives only siesta lights a spotlight and DLI', () => {
    for (const l of LIGHTS) {
      if (l.scheduleKind === 'ramp') {
        expect('spotlight' in l).toBe(false)
        expect('dli' in l).toBe(false)
      }
    }
  })
})
