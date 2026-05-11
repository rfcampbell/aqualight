import { describe, it, expect } from 'vitest'
import { generateYaml, generateNanoYaml, BIOTOPE_LIGHT_CONFIG, NANO_LIGHT_CONFIG } from '../generateYaml'
import type { LightConfig } from '../generateYaml'
import type { ScheduleState, NanoScheduleState } from '../../types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SCHEDULE: ScheduleState = {
  sunrise:             { startMinute: 345, durationMinutes: 15, steps: 3 },
  sunset:              { startMinute: 1020, durationMinutes: 15, steps: 3 },
  cycle: {
    wrgbDuration: 40, spotlightDuration: 20, overlapMinutes: 2,
    cycleStart: 360, cycleEnd: 1020,
  },
  wrgbChannels:        { r: 40, g: 40, b: 40, w: 50 },
  spotlightBrightness: 30,
  ppfdWrgb:            120,
  ppfdSpotlight:       80,
}

const NANO_SCHEDULE: NanoScheduleState = {
  rampUpStart:  420,
  peakStart:    480,
  peakEnd:      1080,
  rampDownEnd:  1140,
  peakRgbw:     { r: 40, g: 40, b: 45, w: 55 },
  stepMinutes:  30,
}

const MQTT_CFG: LightConfig = {
  kind: 'mqtt',
  entityId: 'light.chihiros_wrgb',
  topic:    'chihiros/light/set',
}

// ── generateYaml — light_entities mode (new 100P default) ─────────────────────

describe('generateYaml — light_entities mode (default)', () => {
  const yaml = generateYaml(SCHEDULE)

  it('emits four light.turn_on actions per WRGB-on automation', () => {
    // aquarium_cycle_1_wrgb_on with peak r=g=b=40, w=50
    const block = yaml.split('\n- id:').find(b => b.startsWith(" 'aquarium_cycle_1_wrgb_on'"))!
    expect(block).toBeDefined()
    const turnOns = block.match(/action: light\.turn_on/g) ?? []
    // 4 channel turn_ons + (no spotlight on this first cycle's on-block)
    expect(turnOns.length).toBe(4)
  })

  it('emits brightness_pct equal to the 0-100 channel value (no rescaling)', () => {
    expect(yaml).toContain('brightness_pct: 40')
    expect(yaml).toContain('brightness_pct: 50')
  })

  it('targets the four chihiros-led-control channel entities', () => {
    expect(yaml).toContain('entity_id: light.dywpr120fa39f25d91a7_red')
    expect(yaml).toContain('entity_id: light.dywpr120fa39f25d91a7_green')
    expect(yaml).toContain('entity_id: light.dywpr120fa39f25d91a7_blue')
    expect(yaml).toContain('entity_id: light.dywpr120fa39f25d91a7_white')
  })

  it('emits channels in fixed R/G/B/W order within a WRGB-on action', () => {
    const block = yaml.split('\n- id:').find(b => b.startsWith(" 'aquarium_cycle_1_wrgb_on'"))!
    const iR = block.indexOf('_red')
    const iG = block.indexOf('_green')
    const iB = block.indexOf('_blue')
    const iW = block.indexOf('_white')
    expect(iR).toBeGreaterThan(-1)
    expect(iR).toBeLessThan(iG)
    expect(iG).toBeLessThan(iB)
    expect(iB).toBeLessThan(iW)
  })

  it('does not emit mqtt.publish anywhere', () => {
    expect(yaml).not.toContain('mqtt.publish')
  })

  it('does not emit rgbw_color (used only in ha_light mode)', () => {
    expect(yaml).not.toContain('rgbw_color')
  })

  it('OFF state → light.turn_off on all four channels', () => {
    // aquarium_lights_off ends the day with WRGB off and spotlight off
    const block = yaml.split('\n- id:').find(b => b.startsWith(" 'aquarium_lights_off'"))!
    const turnOffs = block.match(/action: light\.turn_off/g) ?? []
    // 4 WRGB channels + 1 spotlight = 5
    expect(turnOffs.length).toBe(5)
  })

  it('channel value of 0 → light.turn_off on that channel', () => {
    // Sunset step 3/3 is frac=0 which the generator converts to {state:"OFF"}.
    // Use a custom schedule whose peak has w=0 to exercise the per-channel zero path.
    const zeroW = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 0 } })
    const block = zeroW.split('\n- id:').find(b => b.startsWith(" 'aquarium_cycle_1_wrgb_on'"))!
    // Three turn_ons (r,g,b) + one turn_off (w) for this WRGB-on block
    expect((block.match(/action: light\.turn_on/g) ?? []).length).toBe(3)
    // Find the turn_off and check it targets the white channel
    const whiteOff = /action: light\.turn_off\s+target:\s+entity_id: light\.dywpr120fa39f25d91a7_white/
    expect(block).toMatch(whiteOff)
  })

  it('spotlight still uses action: light.turn_on with brightness_pct', () => {
    expect(yaml).toContain('entity_id: light.aquarium_spotlight')
    expect(yaml).toContain(`brightness_pct: ${SCHEDULE.spotlightBrightness}`)
  })

  it('header mentions all four HA entities', () => {
    expect(yaml).toContain('HA entities r=light.dywpr120fa39f25d91a7_red')
    expect(yaml).toContain('g=light.dywpr120fa39f25d91a7_green')
    expect(yaml).toContain('b=light.dywpr120fa39f25d91a7_blue')
    expect(yaml).toContain('w=light.dywpr120fa39f25d91a7_white')
  })

  it('sunrise step 1/3 scales channel values by 1/3', () => {
    // frac=1/3 of {r:40,g:40,b:40,w:50} → 13,13,13,17
    const block = yaml.split('\n- id:').find(b => b.startsWith(" 'aquarium_sunrise_step_1'"))!
    expect(block).toContain('brightness_pct: 13')
    expect(block).toContain('brightness_pct: 17')
  })
})

// ── generateYaml — mqtt mode (explicit) ───────────────────────────────────────

describe('generateYaml — mqtt mode (explicit)', () => {
  const yaml = generateYaml(SCHEDULE, MQTT_CFG)

  it('emits service: mqtt.publish for WRGB', () => {
    expect(yaml).toContain('service: mqtt.publish')
  })

  it('uses the configured MQTT topic', () => {
    expect(yaml).toContain('topic: chihiros/light/set')
  })

  it('peak payload has correct 0-100 channel values', () => {
    expect(yaml).toContain('"red":40')
    expect(yaml).toContain('"green":40')
    expect(yaml).toContain('"blue":40')
    expect(yaml).toContain('"white":50')
  })

  it('does not contain rgbw_color', () => {
    expect(yaml).not.toContain('rgbw_color')
  })

  it('sunrise step 1/3 payload has scaled channel values', () => {
    expect(yaml).toContain('"red":13')
    expect(yaml).toContain('"white":17')
  })

  it('OFF payload is {"state":"OFF"}', () => {
    expect(yaml).toContain('{"state":"OFF"}')
  })

  it('spotlight still uses action: light.turn_on with brightness_pct', () => {
    expect(yaml).toContain('entity_id: light.aquarium_spotlight')
    expect(yaml).toContain(`brightness_pct: ${SCHEDULE.spotlightBrightness}`)
  })

  it('header mentions MQTT topic not HA entity', () => {
    expect(yaml).toContain('MQTT topic chihiros/light/set')
    expect(yaml).not.toContain('HA entity light.chihiros_wrgb')
  })
})

describe('generateYaml — mqtt payload peak scaling', () => {
  it('40% uniform peak → payload values are 40', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } }, MQTT_CFG)
    expect(yaml).toContain('"red":40,"green":40,"blue":40,"white":40')
  })

  it('100% peak → payload values are 100', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 100, g: 100, b: 100, w: 100 } }, MQTT_CFG)
    expect(yaml).toContain('"red":100,"green":100,"blue":100,"white":100')
  })

  it('sunrise step 1/3 at 40% uniform peak → values are 13 (1/3 of 40, rounded)', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } }, MQTT_CFG)
    expect(yaml).toContain('"red":13,"green":13,"blue":13,"white":13')
  })

  it('sunrise step 3/3 equals peak value', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } }, MQTT_CFG)
    const peakPayload = '"red":40,"green":40,"blue":40,"white":40'
    expect(yaml.split(peakPayload).length).toBeGreaterThan(2)
  })
})

// ── generateYaml — ha_light single-entity mode ────────────────────────────────

describe('generateYaml — ha_light single-entity mode', () => {
  const cfg: LightConfig = { kind: 'ha_light', entityId: 'light.chihiros_wrgb' }
  const yaml = generateYaml(SCHEDULE, cfg)

  it('emits action: light.turn_on for ON states', () => {
    expect(yaml).toContain('action: light.turn_on')
  })

  it('emits action: light.turn_off for OFF states', () => {
    expect(yaml).toContain('action: light.turn_off')
  })

  it('uses the provided entityId in turn_on/off actions', () => {
    expect(yaml).toContain('entity_id: light.chihiros_wrgb')
  })

  it('emits rgbw_color with 0-255 scaled values', () => {
    expect(yaml).toContain('rgbw_color: [102, 102, 102, 127]')
  })

  it('does not emit mqtt.publish', () => {
    expect(yaml).not.toContain('mqtt.publish')
  })

  it('does not emit brightness_pct for WRGB blocks', () => {
    const wrgbBlocks = yaml.split('\n- id:').filter(b =>
      b.includes('action: light.turn_on') && b.includes('light.chihiros_wrgb')
    )
    expect(wrgbBlocks.length).toBeGreaterThan(0)
    for (const block of wrgbBlocks) {
      // The spotlight has its own brightness_pct, so only assert on the WRGB
      // light.turn_on lines — pull just the entity-keyed section.
      const wrgbSection = block.split('entity_id: light.aquarium_spotlight')[0]
      expect(wrgbSection).not.toContain('brightness_pct')
    }
  })

  it('header mentions HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_wrgb')
  })
})

// ── generateNanoYaml — mqtt mode (default) ────────────────────────────────────

describe('generateNanoYaml — mqtt mode (default)', () => {
  const yaml = generateNanoYaml(NANO_SCHEDULE)

  it('emits service: mqtt.publish', () => {
    expect(yaml).toContain('service: mqtt.publish')
  })

  it('uses nano MQTT topic', () => {
    expect(yaml).toContain('topic: chihiros/nano/light/set')
  })

  it('does not emit action: light.turn_on', () => {
    expect(yaml).not.toContain('action: light.turn_on')
  })

  it('peak step payload has correct 0-100 channel values', () => {
    expect(yaml).toContain('"red":40')
    expect(yaml).toContain('"white":55')
  })

  it('OFF payload is {"state":"OFF"}', () => {
    expect(yaml).toContain('{"state":"OFF"}')
  })

  it('header mentions MQTT topic', () => {
    expect(yaml).toContain('MQTT topic chihiros/nano/light/set')
  })
})

describe('generateNanoYaml — ha_light single-entity mode', () => {
  const cfg: LightConfig = { kind: 'ha_light', entityId: 'light.chihiros_nano_wrgb' }
  const yaml = generateNanoYaml(NANO_SCHEDULE, cfg)

  it('emits action: light.turn_on for ramp steps', () => {
    expect(yaml).toContain('action: light.turn_on')
  })

  it('emits action: light.turn_off at the end of ramp down (frac=0)', () => {
    expect(yaml).toContain('action: light.turn_off')
  })

  it('does not use mqtt.publish', () => {
    expect(yaml).not.toContain('mqtt.publish')
  })

  it('peak step has correct rgbw_color (0-255 scale)', () => {
    expect(yaml).toContain('rgbw_color: [102, 102, 115, 140]')
  })

  it('header mentions HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_nano_wrgb')
  })
})

// ── Exported default configs ──────────────────────────────────────────────────

describe('exported default configs', () => {
  it('BIOTOPE_LIGHT_CONFIG uses light_entities (new HACS integration)', () => {
    expect(BIOTOPE_LIGHT_CONFIG.kind).toBe('light_entities')
    if (BIOTOPE_LIGHT_CONFIG.kind === 'light_entities') {
      expect(BIOTOPE_LIGHT_CONFIG.entityIds.red).toBe('light.dywpr120fa39f25d91a7_red')
      expect(BIOTOPE_LIGHT_CONFIG.entityIds.green).toBe('light.dywpr120fa39f25d91a7_green')
      expect(BIOTOPE_LIGHT_CONFIG.entityIds.blue).toBe('light.dywpr120fa39f25d91a7_blue')
      expect(BIOTOPE_LIGHT_CONFIG.entityIds.white).toBe('light.dywpr120fa39f25d91a7_white')
    }
  })

  it('NANO_LIGHT_CONFIG uses mqtt by default', () => {
    expect(NANO_LIGHT_CONFIG.kind).toBe('mqtt')
    if (NANO_LIGHT_CONFIG.kind === 'mqtt') {
      expect(NANO_LIGHT_CONFIG.entityId).toBe('light.chihiros_nano_wrgb')
      expect(NANO_LIGHT_CONFIG.topic).toBe('chihiros/nano/light/set')
    }
  })
})
