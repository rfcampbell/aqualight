import type { Light, RampScheduleState, RgbwChannels } from '../types'

/**
 * Turn stored state — browser storage, an HA snapshot, a preset — into a
 * schedule this light can use, or null when it doesn't fit.
 *
 * - Ramp shape: taken field by field; unknown keys are dropped.
 * - Solid-mode shape (the 100P before siesta was removed): converted.
 * - Anything else, siesta included: rejected whole. A partial merge onto
 *   defaults would load a schedule nobody chose.
 */
export function normalizeState(light: Light, raw: unknown): RampScheduleState | null {
  if (!isObj(raw)) return null
  const base = 'mode' in raw || 'cycle' in raw || 'sunrise' in raw ? fromSolid(raw) : fromRamp(raw)
  return base && withSpotlight(light, base, raw)
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isMinute = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440

function rgbw(v: unknown): RgbwChannels | null {
  if (!isObj(v)) return null
  const ch = (['r', 'g', 'b', 'w'] as const).map(k => v[k])
  if (!ch.every(c => typeof c === 'number' && c >= 0 && c <= 100)) return null
  const [r, g, b, w] = ch as number[]
  return { r, g, b, w }
}

function fromRamp(raw: Record<string, unknown>): RampScheduleState | null {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, stepMinutes } = raw
  const peakRgbw = rgbw(raw.peakRgbw)
  if (![rampUpStart, peakStart, peakEnd, rampDownEnd].every(isMinute) || !peakRgbw) return null
  if (typeof stepMinutes !== 'number' || !(stepMinutes >= 1)) return null
  return {
    rampUpStart: rampUpStart as number, peakStart: peakStart as number,
    peakEnd: peakEnd as number, rampDownEnd: rampDownEnd as number,
    peakRgbw, stepMinutes,
  }
}

/**
 * Solid mode held WRGB from cycleStart to cycleEnd between a sunrise and a
 * sunset ramp. The step length is the sunrise's. Siesta (mode absent or
 * 'siesta') has no single peak to convert to.
 */
function fromSolid(raw: Record<string, unknown>): RampScheduleState | null {
  if (raw.mode !== 'solid') return null
  const { sunrise, sunset, cycle } = raw
  if (!isObj(sunrise) || !isObj(sunset) || !isObj(cycle)) return null
  const peakRgbw = rgbw(raw.wrgbChannels)
  const nums = [sunrise.startMinute, sunrise.durationMinutes, sunrise.steps,
                sunset.startMinute, sunset.durationMinutes, cycle.cycleStart, cycle.cycleEnd]
  if (!peakRgbw || !nums.every(n => typeof n === 'number')) return null
  const s = {
    rampUpStart: sunrise.startMinute as number,
    peakStart:   cycle.cycleStart as number,
    peakEnd:     cycle.cycleEnd as number,
    rampDownEnd: (sunset.startMinute as number) + (sunset.durationMinutes as number),
    peakRgbw,
    stepMinutes: Math.max(1, Math.round((sunrise.durationMinutes as number) / ((sunrise.steps as number) || 1))),
  }
  return [s.rampUpStart, s.peakStart, s.peakEnd, s.rampDownEnd].every(isMinute) ? s : null
}

/** Spotlight fields exist exactly when the light has a spotlight; missing ones come from defaults. */
function withSpotlight(light: Light, s: RampScheduleState, raw: Record<string, unknown>): RampScheduleState {
  if (!light.spotlight) return s
  const d = light.defaults
  const pick = (v: unknown, fallback: number | undefined, ok: (n: number) => boolean) =>
    typeof v === 'number' && ok(v) ? v : fallback
  return {
    ...s,
    spotlightBrightness:  pick(raw.spotlightBrightness, d.spotlightBrightness, n => n >= 1 && n <= 100),
    spotlightLeadMinutes: pick(raw.spotlightLeadMinutes, d.spotlightLeadMinutes, n => n >= 0),
    spotlightTailMinutes: pick(raw.spotlightTailMinutes, d.spotlightTailMinutes, n => n >= 0),
  }
}
