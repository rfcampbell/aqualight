import type { Light, RampScheduleState } from '../types'

/** Ramp schedule math shared by the generator, the preview and the DLI estimate. */

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export interface RampEvent {
  phase: 'up' | 'down'
  at: number    // minute of day
  frac: number  // 0-1 of peak; 0 on the way down means off
}

/**
 * The WRGB steps exactly as the generator emits them. Ramp up lands step i of
 * n at rampUpStart + i·step holding i/n, so the light reaches peak at
 * peakStart; frac 0 is skipped because the light is already off from the
 * night before. Ramp down starts at peakEnd at full and reaches off at
 * rampDownEnd.
 */
export function rampEvents(s: RampScheduleState): RampEvent[] {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd } = s
  const step = Math.max(1, s.stepMinutes)
  const out: RampEvent[] = []

  const upSteps = Math.round((peakStart - rampUpStart) / step)
  for (let i = 0; i <= upSteps; i++) {
    const frac = upSteps > 0 ? i / upSteps : 1
    if (frac === 0) continue
    out.push({ phase: 'up', at: rampUpStart + i * step, frac })
  }

  const downSteps = Math.round((rampDownEnd - peakEnd) / step)
  for (let i = 0; i <= downSteps; i++) {
    const at = peakEnd + i * step
    if (at === peakStart) continue
    out.push({ phase: 'down', at, frac: downSteps > 0 ? 1 - i / downSteps : 0 })
  }
  return out
}

/** Spotlight on-windows: lead before ramp-up → peakStart, and peakEnd → tail after ramp-down. */
export function spotWindows(light: Light, s: RampScheduleState): [number, number][] {
  if (!light.spotlight) return []
  return [
    [s.rampUpStart - (s.spotlightLeadMinutes ?? 0), s.peakStart],
    [s.peakEnd, s.rampDownEnd + (s.spotlightTailMinutes ?? 0)],
  ]
}

/** Clock minutes lit: WRGB from ramp-up start to ramp-down end, spotlight across its windows. */
export function photoperiodMinutes(light: Light, s: RampScheduleState) {
  return {
    wrgbMinutes:      s.rampDownEnd - s.rampUpStart,
    spotlightMinutes: spotWindows(light, s).reduce((t, [a, b]) => t + Math.max(0, b - a), 0),
  }
}

/**
 * Full-intensity-equivalent minutes for DLI: each WRGB step counted at its own
 * level for as long as it holds, the spotlight at full across its windows.
 */
export function dliMinutes(light: Light, s: RampScheduleState) {
  const events = [...rampEvents(s)].sort((a, b) => a.at - b.at)
  let wrgb = 0
  events.forEach((e, i) => {
    const until = i + 1 < events.length ? events[i + 1].at : 1440
    wrgb += e.frac * Math.max(0, until - e.at)
  })
  return { wrgbMinutes: wrgb, spotlightMinutes: photoperiodMinutes(light, s).spotlightMinutes }
}

/** Reasons a schedule must not be deployed. Empty when it is valid. */
export function rampProblems(light: Light, s: RampScheduleState): string[] {
  const t = minutesToHHMM
  const out: string[] = []
  if (s.rampUpStart > s.peakStart)
    out.push(`Ramp up starts at ${t(s.rampUpStart)}, after peak start ${t(s.peakStart)}.`)
  if (s.peakStart > s.peakEnd)
    out.push(`Peak starts at ${t(s.peakStart)}, after peak end ${t(s.peakEnd)}.`)
  if (s.peakEnd > s.rampDownEnd)
    out.push(`Peak ends at ${t(s.peakEnd)}, after ramp-down end ${t(s.rampDownEnd)}.`)
  if (light.spotlight) {
    const [[dawnOn], [, duskOff]] = spotWindows(light, s)
    if (dawnOn < 0)     out.push('Spotlight lead reaches back past midnight.')
    if (duskOff > 1439) out.push('Spotlight tail runs past midnight.')
  }
  return out
}
