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

// ── generateYaml — mqtt.publish (default) ────────────────────────────────────

describe('generateYaml — mqtt.publish (default)', () => {
  const yaml = generateYaml(SCHEDULE)

  it('emits service: mqtt.publish for WRGB', () => {
    expect(yaml).toContain('service: mqtt.publish')
  })

  it('does not emit action: light.turn_on for WRGB entity', () => {
    const wrgbTurnOnLines = yaml.split('\n').filter((l, i, lines) =>
      l.includes('action: light.turn_on') &&
      lines.slice(i, i + 5).some(ll => ll.includes('light.chihiros_wrgb'))
    )
    expect(wrgbTurnOnLines).toHaveLength(0)
  })

  it('uses the correct MQTT topic', () => {
    expect(yaml).toContain('topic: chihiros/light/set')
  })

  it('peak payload has correct 0-100 channel values', () => {
    // wrgbChannels: r=g=b=40, w=50 — passed directly (no to255 conversion)
    expect(yaml).toContain('"red":40')
    expect(yaml).toContain('"green":40')
    expect(yaml).toContain('"blue":40')
    expect(yaml).toContain('"white":50')
  })

  it('does not contain rgbw_color (only used in ha-light mode)', () => {
    expect(yaml).not.toContain('rgbw_color')
  })

  it('sunrise step 1/3 payload has scaled channel values', () => {
    // frac=1/3: clamp(40/3)=clamp(13.33)=13, clamp(50/3)=clamp(16.67)=17
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

// ── generateYaml — mqtt payload scales proportionally to peak ────────────────

describe('generateYaml — MQTT payload peak scaling', () => {
  it('40% uniform peak → payload values are 40', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } })
    expect(yaml).toContain('"red":40,"green":40,"blue":40,"white":40')
  })

  it('100% peak → payload values are 100', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 100, g: 100, b: 100, w: 100 } })
    expect(yaml).toContain('"red":100,"green":100,"blue":100,"white":100')
  })

  it('sunrise step 1/3 at 40% uniform peak → values are 13 (1/3 of 40, rounded)', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } })
    // clamp(40 * 1/3) = clamp(13.33) = 13
    expect(yaml).toContain('"red":13,"green":13,"blue":13,"white":13')
  })

  it('sunrise step 3/3 equals peak value', () => {
    const yaml = generateYaml({ ...SCHEDULE, wrgbChannels: { r: 40, g: 40, b: 40, w: 40 } })
    // frac=1: clamp(40*1)=40
    const peakPayload = '"red":40,"green":40,"blue":40,"white":40'
    // Appears in both sunrise step 3 and the cycle blocks
    expect(yaml.split(peakPayload).length).toBeGreaterThan(2)
  })
})

// ── generateYaml — explicit entity override ───────────────────────────────────

describe('generateYaml — explicit entity override (useMqttPublish: false)', () => {
  const cfg: LightConfig = { entityId: 'light.chihiros_wrgb', useMqttPublish: false }
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
    // r=g=b=40 → to255(40)=102, w=50 → to255(50)=127
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
      expect(block).not.toContain('brightness_pct')
    }
  })

  it('header mentions HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_wrgb')
  })
})

// ── generateNanoYaml — mqtt.publish (default) ─────────────────────────────────

describe('generateNanoYaml — mqtt.publish (default)', () => {
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
    // peakRgbw: r=40, g=40, b=45, w=55
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

describe('generateNanoYaml — useMqttPublish: false (ha-light mode)', () => {
  const cfg: LightConfig = {
    entityId:      'light.chihiros_nano_wrgb',
    useMqttPublish: false,
  }
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
    // r=40,g=40,b=45,w=55 → to255: 102,102,115,140
    expect(yaml).toContain('rgbw_color: [102, 102, 115, 140]')
  })

  it('header mentions HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_nano_wrgb')
  })
})

// ── Exported default configs ──────────────────────────────────────────────────

describe('exported default configs', () => {
  it('BIOTOPE_LIGHT_CONFIG uses mqtt.publish by default', () => {
    expect(BIOTOPE_LIGHT_CONFIG.entityId).toBe('light.chihiros_wrgb')
    expect(BIOTOPE_LIGHT_CONFIG.useMqttPublish).toBe(true)
    expect(BIOTOPE_LIGHT_CONFIG.mqttTopic).toBe('chihiros/light/set')
  })

  it('NANO_LIGHT_CONFIG uses mqtt.publish by default', () => {
    expect(NANO_LIGHT_CONFIG.entityId).toBe('light.chihiros_nano_wrgb')
    expect(NANO_LIGHT_CONFIG.useMqttPublish).toBe(true)
    expect(NANO_LIGHT_CONFIG.mqttTopic).toBe('chihiros/nano/light/set')
  })
})
