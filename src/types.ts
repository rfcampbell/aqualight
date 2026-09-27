export interface RgbwChannels {
  r: number
  g: number
  b: number
  w: number
}

export interface RampConfig {
  startMinute: number
  durationMinutes: number
  steps: number
}

export interface CyclePattern {
  wrgbDuration: number      // minutes (default 40)
  spotlightDuration: number // minutes (default 20)
  overlapMinutes: number    // overlap on each transition (default 2)
  cycleStart: number        // minute of day (default 360 = 6:00)
  cycleEnd: number          // minute of day (default 1020 = 17:00)
}

export interface ScheduleState {
  sunrise: RampConfig
  sunset: RampConfig
  cycle: CyclePattern
  wrgbChannels: RgbwChannels   // RGBW levels during on-phase (0-100 per channel)
  spotlightBrightness: number  // 0-255
  ppfdWrgb: number             // µmol/m²/s
  ppfdSpotlight: number        // µmol/m²/s
}

export interface NanoScheduleState {
  rampUpStart: number    // minute of day
  peakStart: number      // minute of day
  peakEnd: number        // minute of day
  rampDownEnd: number    // minute of day
  peakRgbw: RgbwChannels
  stepMinutes: number    // interpolation interval (default 5)
}

export interface TimeBlock {
  id: string
  type: 'wrgb' | 'spotlight' | 'sunrise' | 'sunset' | 'overlap'
  startMinute: number
  endMinute: number
  color: string
}


// ── Light registry ───────────────────────────────────────────────────────────

/**
 * How a WRGB light's automations should be emitted.
 *
 * - `mqtt`: flat 0-100 channel payload via mqtt.publish, for the
 *   chihiros-mqtt bridge.
 * - `ha_light`: one HA light entity taking rgbw_color 0-255.
 * - `light_entities`: four HA light entities, one per channel, each driven
 *   with brightness_pct 0-100. Used by chihiros-led-control (HACS) behind an
 *   ESP32 Bluetooth Proxy.
 */
export type LightConfig =
  | { kind: 'mqtt';           entityId: string; topic: string }
  | { kind: 'ha_light';       entityId: string }
  | {
      kind: 'light_entities'
      entityIds: { red: string; green: string; blue: string; white: string }
    }

/** Which schedule shape, editor and generator a light uses. */
export type ScheduleKind = 'siesta' | 'ramp'

export interface DliParams {
  ppfdWrgb: number
  ppfdSpotlight: number
  /** Set when the values are placeholders rather than measured. */
  todo?: string
}

interface LightBase {
  id: string
  /** Owns every automation id starting with this. Drives the backend merge. */
  prefix: string
  /** `device` value used by the presets API. */
  presetId: string
  label: string
  sublabel?: string
  /** Alias stem: 'Aquarium' produces "Aquarium — Cycle 1 WRGB On". */
  aliasPrefix: string
  transport: LightConfig
  /**
   * Header text, stored verbatim rather than templated: these strings differ
   * between lights in ways a template would not reproduce byte-for-byte.
   * `lampLabel` includes its own padding, so `# ${lampLabel}: ...` aligns.
   */
  header: { title: string; lampLabel: string }
  /** localStorage key, plus which fields to persist (all of them if absent). */
  storage: { key: string; fields?: string[] }
  /** Endpoint for the live device test, when the transport needs a dedicated one. */
  mqttTestEndpoint?: string
  /**
   * PAR/DLI parameters. Optional: a light can be in the registry before its
   * output has been measured. Only siesta lights currently surface an
   * estimator in the UI, because NanoScheduleState carries no ppfd fields.
   */
  dli?: DliParams
}

export interface SiestaLight extends LightBase {
  scheduleKind: 'siesta'
  defaults: ScheduleState
  spotlight?: { entityId: string }
}

export interface RampLight extends LightBase {
  scheduleKind: 'ramp'
  defaults: NanoScheduleState
}

export type Light = SiestaLight | RampLight
