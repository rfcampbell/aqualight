import type { ScheduleState, TimeBlock } from '../types'

export interface WaveformPoint {
  minute: number
  wrgb: number      // 0–1
  spotlight: number // 0–1
}

export function generateBlocks(state: ScheduleState): TimeBlock[] {
  const blocks: TimeBlock[] = []
  const { sunrise, sunset, cycle } = state

  // Sunrise ramp (WRGB row)
  blocks.push({
    id: 'sunrise',
    type: 'sunrise',
    startMinute: sunrise.startMinute,
    endMinute: sunrise.startMinute + sunrise.durationMinutes,
    color: 'linear-gradient(to right, #000000, #1a6b9a)',
  })

  // Sunset ramp (WRGB row)
  blocks.push({
    id: 'sunset',
    type: 'sunset',
    startMinute: sunset.startMinute,
    endMinute: sunset.startMinute + sunset.durationMinutes,
    color: 'linear-gradient(to right, #1a6b9a, #000000)',
  })

  // Generate cycling blocks between cycleStart and cycleEnd
  const { wrgbDuration, spotlightDuration, overlapMinutes, cycleStart, cycleEnd } = cycle
  // Each full cycle: WRGB on for wrgbDuration, then transition with overlap, then spotlight for spotlightDuration
  // Overlap = both lights on simultaneously at transitions
  // Pattern per cycle:
  //   [wrgb exclusive] [overlap: both on] [spotlight exclusive] [overlap: both on]
  // But to keep it simple and matching the spec (2-min overlaps on each transition):
  //   WRGB starts, runs wrgbDuration. Spotlight starts (overlapMinutes before WRGB ends).
  //   Spotlight runs spotlightDuration. WRGB restarts (overlapMinutes before spotlight ends).

  let cursor = cycleStart
  let cycleIndex = 0
  let isWrgbPhase = true // start with WRGB

  while (cursor < cycleEnd) {
    if (isWrgbPhase) {
      const wrgbStart = cursor
      const wrgbEnd = Math.min(cursor + wrgbDuration, cycleEnd)
      const wrgbExclusiveEnd = Math.min(wrgbEnd - overlapMinutes, cycleEnd)

      // WRGB exclusive block (before overlap)
      if (wrgbStart < wrgbExclusiveEnd) {
        blocks.push({
          id: `wrgb-${cycleIndex}`,
          type: 'wrgb',
          startMinute: wrgbStart,
          endMinute: wrgbExclusiveEnd,
          color: 'linear-gradient(135deg, #0d4f6e 0%, #1a8a6e 100%)',
        })
      }

      // Overlap at end of WRGB (transition to spotlight)
      const overlapStart = wrgbExclusiveEnd
      const overlapEnd = Math.min(wrgbEnd, cycleEnd)
      if (overlapStart < overlapEnd) {
        blocks.push({
          id: `overlap-wrgb-${cycleIndex}`,
          type: 'overlap',
          startMinute: overlapStart,
          endMinute: overlapEnd,
          color: 'linear-gradient(135deg, #1a6b9a 0%, #d4a017 100%)',
        })
      }

      cursor = wrgbEnd
    } else {
      // Spotlight phase
      const slStart = cursor
      const slEnd = Math.min(cursor + spotlightDuration, cycleEnd)
      const slExclusiveEnd = Math.min(slEnd - overlapMinutes, cycleEnd)

      // Spotlight exclusive block
      if (slStart < slExclusiveEnd) {
        blocks.push({
          id: `spotlight-${cycleIndex}`,
          type: 'spotlight',
          startMinute: slStart,
          endMinute: slExclusiveEnd,
          color: 'linear-gradient(135deg, #c47a00 0%, #e8a020 100%)',
        })
      }

      // Overlap at end of spotlight (transition back to WRGB)
      const overlapStart = slExclusiveEnd
      const overlapEnd = Math.min(slEnd, cycleEnd)
      if (overlapStart < overlapEnd) {
        blocks.push({
          id: `overlap-sl-${cycleIndex}`,
          type: 'overlap',
          startMinute: overlapStart,
          endMinute: overlapEnd,
          color: 'linear-gradient(135deg, #d4a017 0%, #1a6b9a 100%)',
        })
      }

      cursor = slEnd
      cycleIndex++
    }

    isWrgbPhase = !isWrgbPhase
    if (cursor >= cycleEnd) break
  }

  return blocks.sort((a, b) => a.startMinute - b.startMinute)
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function calcPhotoperiodMinutes(state: ScheduleState): { wrgbMinutes: number; spotlightMinutes: number } {
  const { cycle, sunrise, sunset } = state
  const { wrgbDuration, spotlightDuration, overlapMinutes, cycleStart, cycleEnd } = cycle
  const totalCycleMinutes = cycleEnd - cycleStart
  const cyclePeriod = wrgbDuration + spotlightDuration - overlapMinutes

  if (cyclePeriod <= 0) return { wrgbMinutes: 0, spotlightMinutes: 0 }

  const fullCycles = Math.floor(totalCycleMinutes / cyclePeriod)
  const remainder = totalCycleMinutes % cyclePeriod

  // WRGB: sunrise ramp + each WRGB phase
  const wrgbPerCycle = wrgbDuration
  const slPerCycle = spotlightDuration

  // Full cycles: each cycle has wrgbDuration of wrgb and spotlightDuration of spotlight
  // Overlaps are shared, but for photoperiod purposes count them per lamp
  let wrgbTotal = sunrise.durationMinutes + fullCycles * wrgbPerCycle
  let slTotal = fullCycles * slPerCycle

  // Handle remainder
  if (remainder > 0) {
    // Remainder starts with WRGB phase
    wrgbTotal += Math.min(remainder, wrgbDuration)
    if (remainder > wrgbDuration) {
      slTotal += Math.min(remainder - wrgbDuration, spotlightDuration)
    }
  }

  // Add sunset duration to WRGB
  wrgbTotal += sunset.durationMinutes

  return { wrgbMinutes: wrgbTotal, spotlightMinutes: slTotal }
}

/**
 * Generate waveform keypoints for smooth SVG rendering.
 * Points define (minute, wrgb 0-1, spotlight 0-1) at every state transition.
 * Consecutive points at the same minute produce a near-vertical bezier step.
 */
export function generateWaveformPoints(state: ScheduleState): WaveformPoint[] {
  const { sunrise, sunset, cycle } = state
  const pts: WaveformPoint[] = []
  const add = (minute: number, wrgb: number, spotlight: number) =>
    pts.push({ minute, wrgb, spotlight })

  // Start: off
  add(0, 0, 0)

  // Sunrise: N steps of (duration/steps) minutes each
  const sunriseStepMin = sunrise.durationMinutes / sunrise.steps
  for (let i = 0; i <= sunrise.steps; i++) {
    add(sunrise.startMinute + i * sunriseStepMin, i / sunrise.steps, 0)
  }

  // Cycling
  let cursor = cycle.cycleStart
  let isWrgbPhase = true
  while (cursor < cycle.cycleEnd) {
    if (isWrgbPhase) {
      const phaseEnd = Math.min(cursor + cycle.wrgbDuration, cycle.cycleEnd)
      const overlapStart = Math.max(cursor, phaseEnd - cycle.overlapMinutes)
      add(cursor, 1, 0)             // WRGB phase starts
      add(overlapStart, 1, 0)       // exclusive WRGB ends
      add(overlapStart, 1, 1)       // spotlight joins (overlap begins)
      add(phaseEnd, 0, 1)           // WRGB leaves (overlap ends)
      cursor = phaseEnd
    } else {
      const phaseEnd = Math.min(cursor + cycle.spotlightDuration, cycle.cycleEnd)
      const overlapStart = Math.max(cursor, phaseEnd - cycle.overlapMinutes)
      add(cursor, 0, 1)             // spotlight phase starts
      add(overlapStart, 0, 1)       // exclusive spotlight ends
      add(overlapStart, 1, 1)       // WRGB joins (overlap begins)
      add(phaseEnd, 1, 0)           // spotlight leaves (overlap ends)
      cursor = phaseEnd
    }
    isWrgbPhase = !isWrgbPhase
    if (cursor >= cycle.cycleEnd) break
  }

  // Sunset: N steps stepping down
  const sunsetStepMin = sunset.durationMinutes / sunset.steps
  for (let i = 0; i <= sunset.steps; i++) {
    add(sunset.startMinute + i * sunsetStepMin, 1 - i / sunset.steps, 0)
  }

  // End: off
  add(1440, 0, 0)

  return pts
}
