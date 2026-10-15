import type { ScheduleState, ScheduleMode, SiestaLight } from '../types'
import { minutesToHHMM } from './generateBlocks'

/** Solid-mode helpers: one continuous photoperiod, spotlight bracketing the ramps. */

export const DEFAULT_LEAD = 15
export const DEFAULT_TAIL = 15

export const modeOf = (s: ScheduleState): ScheduleMode => s.mode ?? 'siesta'
export const leadOf = (s: ScheduleState) => s.spotlightLeadMinutes ?? DEFAULT_LEAD
export const tailOf = (s: ScheduleState) => s.spotlightTailMinutes ?? DEFAULT_TAIL

export const sunriseEnd = (s: ScheduleState) => s.sunrise.startMinute + s.sunrise.durationMinutes
export const sunsetEnd  = (s: ScheduleState) => s.sunset.startMinute + s.sunset.durationMinutes

/** Spotlight on-windows in solid mode: [lead before sunrise → core start], [sunset start → tail after sunset]. */
export function spotWindows(s: ScheduleState): [number, number][] {
  return [
    [s.sunrise.startMinute - leadOf(s), s.cycle.cycleStart],
    [s.sunset.startMinute, sunsetEnd(s) + tailOf(s)],
  ]
}

/** Last moment anything is lit. Solid mode's lights-off waits out the spotlight tail. */
export function dayEnd(s: ScheduleState): number {
  return modeOf(s) === 'solid' ? sunsetEnd(s) + tailOf(s) : sunsetEnd(s)
}

/**
 * Switch mode, seeding that mode's schedule defaults. Channel levels and
 * timings differ enough between the two patterns that carrying one over
 * would be wrong more often than right; PPFD and spotlight brightness carry.
 */
export function switchMode(s: ScheduleState, mode: ScheduleMode, light: SiestaLight): ScheduleState {
  if (mode === 'solid') {
    const d = light.solidDefaults
    if (!d) return s
    return {
      ...s, mode,
      sunrise: d.sunrise, sunset: d.sunset, wrgbChannels: d.wrgbChannels,
      cycle: { ...s.cycle, cycleStart: d.cycleStart, cycleEnd: d.cycleEnd },
      spotlightLeadMinutes: d.spotlightLeadMinutes,
      spotlightTailMinutes: d.spotlightTailMinutes,
    }
  }
  const d = light.defaults
  return { ...s, mode, sunrise: d.sunrise, sunset: d.sunset, cycle: d.cycle, wrgbChannels: d.wrgbChannels }
}

/** Reasons a solid schedule cannot be deployed. Empty for siesta, or when valid. */
export function solidProblems(s: ScheduleState): string[] {
  if (modeOf(s) !== 'solid') return []
  const out: string[] = []
  const { cycleStart, cycleEnd } = s.cycle
  if (sunriseEnd(s) > cycleStart)
    out.push(`Sunrise ends at ${minutesToHHMM(sunriseEnd(s))}, after core start ${minutesToHHMM(cycleStart)}.`)
  if (s.sunset.startMinute < cycleEnd)
    out.push(`Sunset starts at ${minutesToHHMM(s.sunset.startMinute)}, before core end ${minutesToHHMM(cycleEnd)}.`)
  if (cycleEnd <= cycleStart)
    out.push(`Core end ${minutesToHHMM(cycleEnd)} is not after core start ${minutesToHHMM(cycleStart)}.`)
  if (s.sunrise.startMinute - leadOf(s) < 0)
    out.push('Spotlight lead reaches back past midnight.')
  if (sunsetEnd(s) + tailOf(s) > 1440)
    out.push('Spotlight tail runs past midnight.')
  return out
}

/**
 * WRGB level (0–1) at a minute, exactly as the generated automations set it:
 * sunrise step i of n holds i/n, the core holds 1 from the last sunrise step
 * until the sunset ramp, sunset step i of n holds 1 - (i+1)/n.
 */
export function solidWrgbLevel(s: ScheduleState, minute: number): number {
  const { sunrise, sunset } = s
  const upDur = sunrise.durationMinutes / sunrise.steps
  const dnDur = sunset.durationMinutes / sunset.steps
  if (minute < sunrise.startMinute) return 0
  if (minute < sunset.startMinute) {
    const i = Math.floor((minute - sunrise.startMinute) / upDur) + 1
    return i >= sunrise.steps ? 1 : i / sunrise.steps
  }
  const i = Math.floor((minute - sunset.startMinute) / dnDur)
  return i >= sunset.steps ? 0 : Math.max(0, 1 - (i + 1) / sunset.steps)
}

/** Clock minutes lit, ramps included, matching how siesta's photoperiod counts. */
export function solidPhotoperiodMinutes(s: ScheduleState): { wrgbMinutes: number; spotlightMinutes: number } {
  return {
    wrgbMinutes:      sunsetEnd(s) - s.sunrise.startMinute,
    spotlightMinutes: spotWindows(s).reduce((t, [a, b]) => t + Math.max(0, b - a), 0),
  }
}

/**
 * Full-intensity-equivalent minutes for DLI: ramp steps at their fractional
 * levels plus the solid core, and the spotlight's two windows.
 */
export function solidDliMinutes(s: ScheduleState): { wrgbMinutes: number; spotlightMinutes: number } {
  const { sunrise, sunset } = s
  const upDur = sunrise.durationMinutes / sunrise.steps
  const dnDur = sunset.durationMinutes / sunset.steps
  let wrgb = 0
  // Sunrise steps 1..n-1 hold i/n for one step; step n is full and runs into the core.
  for (let i = 1; i < sunrise.steps; i++) wrgb += upDur * i / sunrise.steps
  wrgb += sunset.startMinute - (sunrise.startMinute + (sunrise.steps - 1) * upDur)
  for (let i = 0; i < sunset.steps; i++) wrgb += dnDur * Math.max(0, 1 - (i + 1) / sunset.steps)
  return { wrgbMinutes: wrgb, spotlightMinutes: solidPhotoperiodMinutes(s).spotlightMinutes }
}
