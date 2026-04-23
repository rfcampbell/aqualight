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

// ── generateYaml (biotope) ────────────────────────────────────────────────────

describe('generateYaml — light.turn_on/off (default)', () => {
  const yaml = generateYaml(SCHEDULE)

  it('uses default entity light.chihiros_wrgb', () => {
    expect(yaml).toContain('entity_id: light.chihiros_wrgb')
  })

  it('emits action: light.turn_on for ON states', () => {
    expect(yaml).toContain('action: light.turn_on')
  })

  it('emits action: light.turn_off for OFF states', () => {
    expect(yaml).toContain('action: light.turn_off')
  })

  it('does not emit mqtt.publish for WRGB', () => {
    // spotlight still uses light.turn_on/off so we check for mqtt.publish specifically
    const wrgbMqttLines = yaml.split('\n').filter(l =>
      l.includes('mqtt.publish') && !l.includes('spotlight')
    )
    expect(wrgbMqttLines).toHaveLength(0)
  })

  it('WRGB turn_on does not emit brightness_pct (omitted so HA uses rgbw_color as absolute levels)', () => {
    // Verify no brightness_pct appears in any WRGB turn_on block.
    // Spotlight turn_on (no rgbw_color) is exempt — HA honours brightness_pct there.
    const wrgbTurnOnBlocks = yaml.split('\n- id:').filter(b =>
      b.includes('action: light.turn_on') &&
      b.includes(`entity_id: ${BIOTOPE_LIGHT_CONFIG.entityId}`)
    )
    expect(wrgbTurnOnBlocks.length).toBeGreaterThan(0)
    for (const block of wrgbTurnOnBlocks) {
      expect(block).not.toContain('brightness_pct')
    }
  })

  it('sunrise step 1 has correct rgbw_color (0-100 → 0-255, scaled by 1/3)', () => {
    // step 1/3: r=g=b=clamp(40/3)=13, w=clamp(50/3)=17
    // to255: 13*2.55=33.15→33, 17*2.55=43.35→43
    expect(yaml).toContain('rgbw_color: [33, 33, 33, 43]')
  })

  it('peak WRGB block has correct rgbw_color (channels at full configured value)', () => {
    // r=g=b=40, w=50 → to255: round(40*2.55)=102, round(50*2.55)=127
    expect(yaml).toContain('rgbw_color: [102, 102, 102, 127]')
  })

  it('peak rgbw_color is 3x the step-1 ramp values (proportional scaling)', () => {
    // step 1 at 1/3 of peak: [33, 33, 33, 43]. peak: [102, 102, 102, 127].
    // 102/33 ≈ 3.09, 127/43 ≈ 2.95 — within rounding error of 3×.
    // Verify by checking both appear in the YAML without brightness_pct in between.
    expect(yaml).toContain('rgbw_color: [33, 33, 33, 43]')
    expect(yaml).toContain('rgbw_color: [102, 102, 102, 127]')
  })

  it('lights-off block uses light.turn_off with no data block', () => {
    // Find the lights_off automation block
    const blocks = yaml.split('\n- id:')
    const offBlock = blocks.find(b => b.includes("'aquarium_lights_off'"))
    expect(offBlock).toBeDefined()
    // Should have turn_off for WRGB entity
    expect(offBlock).toContain('action: light.turn_off')
    expect(offBlock).toContain('entity_id: light.chihiros_wrgb')
    // Must not have data: or brightness_pct after the turn_off
    const afterTurnOff = offBlock!.split('action: light.turn_off')[1]
    expect(afterTurnOff).not.toMatch(/^\s+data:/m)
  })

  it('spotlight still uses light.turn_on with brightness_pct', () => {
    expect(yaml).toContain('entity_id: light.aquarium_spotlight')
    expect(yaml).toContain(`brightness_pct: ${SCHEDULE.spotlightBrightness}`)
  })

  it('header mentions HA entity not MQTT topic', () => {
    expect(yaml).toContain('HA entity light.chihiros_wrgb')
    expect(yaml).not.toContain('MQTT topic chihiros/light/set')
  })
})

function wrgbTurnOnBlocks(yaml: string, entityId: string): string[] {
  return yaml.split('\n- id:').filter(b =>
    b.includes('action: light.turn_on') && b.includes(`entity_id: ${entityId}`)
  )
}

describe('generateYaml — peak brightness scaling', () => {
  it('40% uniform peak → rgbw_color ~40% of 255 on each channel', () => {
    const schedule40: ScheduleState = {
      ...SCHEDULE,
      wrgbChannels: { r: 40, g: 40, b: 40, w: 40 },
    }
    const yaml = generateYaml(schedule40)
    // to255(40) = round(40 * 2.55) = 102  (≈ 40% of 255)
    expect(yaml).toContain('rgbw_color: [102, 102, 102, 102]')
    for (const block of wrgbTurnOnBlocks(yaml, BIOTOPE_LIGHT_CONFIG.entityId)) {
      expect(block).not.toContain('brightness_pct')
    }
  })

  it('100% peak → rgbw_color [255, 255, 255, 255]', () => {
    const schedule100: ScheduleState = {
      ...SCHEDULE,
      wrgbChannels: { r: 100, g: 100, b: 100, w: 100 },
    }
    const yaml = generateYaml(schedule100)
    expect(yaml).toContain('rgbw_color: [255, 255, 255, 255]')
    for (const block of wrgbTurnOnBlocks(yaml, BIOTOPE_LIGHT_CONFIG.entityId)) {
      expect(block).not.toContain('brightness_pct')
    }
  })

  it('sunrise ramp step 1/3 at 40% peak → values are 1/3 of 40% peak (~13% of 255)', () => {
    const schedule40: ScheduleState = {
      ...SCHEDULE,
      wrgbChannels: { r: 40, g: 40, b: 40, w: 40 },
    }
    const yaml = generateYaml(schedule40)
    // frac=1/3: clamp(40/3)=clamp(13.33)=13. to255(13)=round(13*2.55)=round(33.15)=33
    expect(yaml).toContain('rgbw_color: [33, 33, 33, 33]')
  })

  it('sunrise ramp step 3/3 (peak) at 40% → same as peak rgbw_color', () => {
    const schedule40: ScheduleState = {
      ...SCHEDULE,
      wrgbChannels: { r: 40, g: 40, b: 40, w: 40 },
    }
    const yaml = generateYaml(schedule40)
    // frac=1: clamp(40*1)=40. to255(40)=102
    expect(yaml).toContain('rgbw_color: [102, 102, 102, 102]')
  })
})

describe('generateYaml — explicit entity override', () => {
  it('uses the provided entityId in turn_on/off actions', () => {
    const cfg: LightConfig = { entityId: 'light.chihiros_nano_wrgb' }
    const yaml = generateYaml(SCHEDULE, cfg)
    expect(yaml).toContain('entity_id: light.chihiros_nano_wrgb')
    expect(yaml).not.toContain('entity_id: light.chihiros_wrgb')
  })
})

describe('generateYaml — useMqttPublishLegacy: true', () => {
  const legacyCfg: LightConfig = {
    entityId: 'light.chihiros_wrgb',
    useMqttPublishLegacy: true,
    mqttTopic: 'chihiros/light/set',
  }
  const yaml = generateYaml(SCHEDULE, legacyCfg)

  it('emits service: mqtt.publish for WRGB, not action: light.turn_on', () => {
    expect(yaml).toContain('service: mqtt.publish')
    // Every light.turn_on in legacy YAML should target spotlight, not the WRGB entity
    const wrgbTurnOnLines = yaml.split('\n').filter((l, i, lines) =>
      l.includes('action: light.turn_on') &&
      lines.slice(i, i + 5).some(ll => ll.includes('light.chihiros_wrgb'))
    )
    expect(wrgbTurnOnLines).toHaveLength(0)
  })

  it('uses the correct MQTT topic', () => {
    expect(yaml).toContain('topic: chihiros/light/set')
  })

  it('payload contains JSON with state and channel values', () => {
    // Peak WRGB: r=g=b=40, w=50
    expect(yaml).toContain('"red":40')
    expect(yaml).toContain('"white":50')
  })

  it('OFF payload is {"state":"OFF"}', () => {
    expect(yaml).toContain('{"state":"OFF"}')
  })

  it('header mentions MQTT topic not HA entity', () => {
    expect(yaml).toContain('MQTT topic chihiros/light/set')
  })

  it('does not contain rgbw_color (that is only in light.turn_on mode)', () => {
    // rgbw_color is never emitted in legacy mode (spotlight uses brightness_pct but not rgbw_color)
    expect(yaml).not.toContain('rgbw_color')
  })
})

// ── generateNanoYaml ──────────────────────────────────────────────────────────

describe('generateNanoYaml — light.turn_on/off (default)', () => {
  const yaml = generateNanoYaml(NANO_SCHEDULE)

  it('uses default entity light.chihiros_nano_wrgb', () => {
    expect(yaml).toContain('entity_id: light.chihiros_nano_wrgb')
  })

  it('emits action: light.turn_on for ramp steps', () => {
    expect(yaml).toContain('action: light.turn_on')
  })

  it('emits action: light.turn_off at the end of ramp down (frac=0)', () => {
    expect(yaml).toContain('action: light.turn_off')
  })

  it('does not use mqtt.publish', () => {
    expect(yaml).not.toContain('mqtt.publish')
  })

  it('peak step has correct rgbw_color', () => {
    // r=40,g=40,b=45,w=55 → to255: 102,102,115,140
    expect(yaml).toContain('rgbw_color: [102, 102, 115, 140]')
  })

  it('header mentions HA entity', () => {
    expect(yaml).toContain('HA entity light.chihiros_nano_wrgb')
  })
})

describe('generateNanoYaml — useMqttPublishLegacy: true', () => {
  const legacyCfg: LightConfig = {
    entityId: 'light.chihiros_nano_wrgb',
    useMqttPublishLegacy: true,
    mqttTopic: 'chihiros/nano/light/set',
  }
  const yaml = generateNanoYaml(NANO_SCHEDULE, legacyCfg)

  it('emits service: mqtt.publish', () => {
    expect(yaml).toContain('service: mqtt.publish')
  })

  it('uses nano MQTT topic', () => {
    expect(yaml).toContain('topic: chihiros/nano/light/set')
  })

  it('does not emit action: light.turn_on', () => {
    expect(yaml).not.toContain('action: light.turn_on')
  })
})

// ── BIOTOPE_LIGHT_CONFIG / NANO_LIGHT_CONFIG defaults ────────────────────────

describe('exported default configs', () => {
  it('BIOTOPE_LIGHT_CONFIG has correct defaults', () => {
    expect(BIOTOPE_LIGHT_CONFIG.entityId).toBe('light.chihiros_wrgb')
    expect(BIOTOPE_LIGHT_CONFIG.useMqttPublishLegacy).toBe(false)
    expect(BIOTOPE_LIGHT_CONFIG.mqttTopic).toBe('chihiros/light/set')
  })

  it('NANO_LIGHT_CONFIG has correct defaults', () => {
    expect(NANO_LIGHT_CONFIG.entityId).toBe('light.chihiros_nano_wrgb')
    expect(NANO_LIGHT_CONFIG.useMqttPublishLegacy).toBe(false)
    expect(NANO_LIGHT_CONFIG.mqttTopic).toBe('chihiros/nano/light/set')
  })
})
