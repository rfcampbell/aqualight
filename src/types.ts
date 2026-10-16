export interface RgbwChannels {
  r: number
  g: number
  b: number
  w: number
}

/**
 * One photoperiod: ramp up to a held peak, ramp down to off. Every light uses
 * this shape. The spotlight fields are present exactly when the light's
 * registry entry has a spotlight.
 */
export interface RampScheduleState {
  rampUpStart: number    // minute of day
  peakStart: number      // minute of day
  peakEnd: number        // minute of day
  rampDownEnd: number    // minute of day
  peakRgbw: RgbwChannels // 0-100 per channel
  stepMinutes: number    // interpolation interval
  spotlightBrightness?: number   // brightness_pct, 1-100
  spotlightLeadMinutes?: number  // on this long before rampUpStart, off at peakStart
  spotlightTailMinutes?: number  // on at peakEnd, off this long after rampDownEnd
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

export interface DliParams {
  ppfdWrgb: number
  ppfdSpotlight: number
  /** Set when the values are placeholders rather than measured. */
  todo?: string
}

export interface Light {
  id: string
  /** Owns every automation id starting with this. Drives the backend merge. */
  prefix: string
  /** `device` value used by the presets API. */
  presetId: string
  label: string
  sublabel?: string
  /** Alias stem: 'Nano' produces "Nano — Ramp Up 07:05 (4%)". */
  aliasPrefix: string
  transport: LightConfig
  /** A second lamp that brackets the ramps. Its levels live in the schedule. */
  spotlight?: { entityId: string }
  /**
   * Header text, stored verbatim rather than templated: these strings differ
   * between lights in ways a template would not reproduce byte-for-byte.
   * `lampLabel` includes its own padding, so `# ${lampLabel}: ...` aligns.
   */
  header: { title: string; lampLabel: string }
  /** localStorage key. The whole schedule is stored under it. */
  storage: { key: string }
  /** Endpoint for the live device test, when the transport needs a dedicated one. */
  mqttTestEndpoint?: string
  /**
   * True while the entry still carries placeholder entity ids. The backend
   * refuses to deploy such a light: its YAML would command entities that do
   * not exist, and the failure would be silent in HA.
   */
  placeholder?: boolean
  /** PAR/DLI parameters. Optional: a light can be in the registry before its output is measured. */
  dli?: DliParams
  defaults: RampScheduleState
}
