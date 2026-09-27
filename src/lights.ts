import type { Light, SiestaLight, RampLight, DliParams } from './types'
import shared from '../backend/lights.json'

/**
 * The light registry: one entry per physical lamp.
 *
 * Identity that the backend also needs (id, prefix, presetId) lives in
 * backend/lights.json and is repeated here for readability; the two are
 * checked against each other in src/__tests__/lights.test.ts, so they cannot
 * drift silently.
 *
 * Adding a light means adding an entry here and in that JSON file. Nothing
 * else should need to change.
 */

// One literal per measured value, referenced by both `dli` and `defaults`.
const BIOTOPE_DLI: DliParams = { ppfdWrgb: 120, ppfdSpotlight: 80 }

const BIOTOPE: SiestaLight = {
  id:          'biotope',
  prefix:      'aquarium_',
  presetId:    'biotope',
  label:       '100P Biotope',
  aliasPrefix: 'Aquarium',
  scheduleKind: 'siesta',
  transport: {
    kind: 'light_entities',
    entityIds: {
      red:   'light.dywpr120fa39f25d91a7_red',
      green: 'light.dywpr120fa39f25d91a7_green',
      blue:  'light.dywpr120fa39f25d91a7_blue',
      white: 'light.dywpr120fa39f25d91a7_white',
    },
  },
  spotlight: { entityId: 'light.aquarium_spotlight' },
  header: {
    title:     'AquaLight — Home Assistant automations',
    lampLabel: 'WRGB lamp  ',
  },
  storage: {
    key: 'aqualight_defaults',
    // Legacy: this key has only ever held these two fields.
    fields: ['wrgbChannels', 'spotlightBrightness'],
  },
  dli: BIOTOPE_DLI,
  defaults: {
    sunrise: { startMinute: 345, durationMinutes: 15, steps: 3 },
    sunset:  { startMinute: 1020, durationMinutes: 15, steps: 3 },
    cycle: {
      wrgbDuration: 40, spotlightDuration: 20, overlapMinutes: 2,
      cycleStart: 360, cycleEnd: 1020,
    },
    wrgbChannels:        { r: 40, g: 40, b: 40, w: 50 },
    spotlightBrightness: 30,
    ...BIOTOPE_DLI,
  },
}

const NANO: RampLight = {
  id:          'nano',
  prefix:      'nano_',
  presetId:    'nano',
  label:       'WRGB II Pro',
  sublabel:    'UNS 45U',
  aliasPrefix: 'Nano',
  scheduleKind: 'ramp',
  transport: {
    kind:     'mqtt',
    entityId: 'light.chihiros_nano_wrgb',
    topic:    'chihiros/nano/light/set',
  },
  header: {
    title:     'AquaLight — Nano (Chihiros WRGB II Pro · UNS 45U) automations',
    lampLabel: 'WRGB II Pro ',
  },
  storage:          { key: 'aqualight_nano' },
  mqttTestEndpoint: '/api/test/nano',
  defaults: {
    rampUpStart: 420,   // 07:00
    peakStart:   540,   // 09:00
    peakEnd:     1080,  // 18:00
    rampDownEnd: 1200,  // 20:00
    peakRgbw:    { r: 40, g: 40, b: 45, w: 55 },
    stepMinutes: 5,
  },
}

/**
 * Display — Chihiros WRGB II Pro 90. NOT YET DELIVERED.
 *
 * TODO on arrival:
 *  - replace the placeholder entity ids with the real ones from
 *    chihiros-led-control (the 100P's are opaque device ids, e.g.
 *    light.dywpr120fa39f25d91a7_red, so expect the same shape, not display_*)
 *  - measure PPFD and replace DISPLAY_DLI
 *  - set real ramp waypoints; the times below are copied from the nano
 */
const DISPLAY_DLI: DliParams = {
  ppfdWrgb:      100,  // TODO placeholder — not measured
  ppfdSpotlight: 0,    // no spotlight on this light
  todo:          'Placeholder values. Measure PPFD once the WRGB II Pro 90 is installed.',
}

const DISPLAY: RampLight = {
  id:          'display',
  prefix:      'display_',
  presetId:    'display',
  label:       'WRGB II Pro 90',
  sublabel:    'Display',
  aliasPrefix: 'Display',
  scheduleKind: 'ramp',
  // Same transport as the 100P: four HA entities via chihiros-led-control.
  transport: {
    kind: 'light_entities',
    entityIds: {
      red:   'light.display_red',    // TODO placeholder
      green: 'light.display_green',  // TODO placeholder
      blue:  'light.display_blue',   // TODO placeholder
      white: 'light.display_white',  // TODO placeholder
    },
  },
  header: {
    title:     'AquaLight — Display (Chihiros WRGB II Pro 90) automations',
    lampLabel: 'WRGB II Pro ',
  },
  storage: { key: 'aqualight_display' },
  dli:     DISPLAY_DLI,
  defaults: {
    rampUpStart: 420,   // 07:00  TODO placeholder
    peakStart:   540,   // 09:00  TODO placeholder
    peakEnd:     1080,  // 18:00  TODO placeholder
    rampDownEnd: 1200,  // 20:00  TODO placeholder
    peakRgbw:    { r: 40, g: 40, b: 45, w: 55 },  // TODO placeholder
    stepMinutes: 5,
  },
}

export const LIGHTS: Light[] = [BIOTOPE, NANO, DISPLAY]

export const KNOWN_PREFIXES: string[] = LIGHTS.map(l => l.prefix)

export function lightById(id: string): Light | undefined {
  return LIGHTS.find(l => l.id === id)
}

/** Identity as the backend sees it. Compared against LIGHTS in the tests. */
export const SHARED_LIGHTS: Array<{ id: string; prefix: string; presetId: string }> =
  shared.lights

/**
 * Throws if src/lights.ts and backend/lights.json disagree. The backend
 * derives KNOWN_PREFIXES from the JSON, so a mismatch means the UI would
 * offer a light whose deploy the backend rejects.
 */
export function assertRegistryAgrees(): void {
  const mine   = LIGHTS.map(l => `${l.id}|${l.prefix}|${l.presetId}`).sort()
  const theirs = SHARED_LIGHTS.map(l => `${l.id}|${l.prefix}|${l.presetId}`).sort()
  if (mine.length !== theirs.length || mine.some((m, i) => m !== theirs[i])) {
    throw new Error(
      'Light registry mismatch between src/lights.ts and backend/lights.json:\n' +
      `  src/lights.ts       : ${mine.join(', ')}\n` +
      `  backend/lights.json : ${theirs.join(', ')}`,
    )
  }
}
