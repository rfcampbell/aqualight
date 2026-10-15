import type { ScheduleState } from '../../../types'

/**
 * Siesta schedules whose YAML is frozen in this directory. The .yaml files
 * were written by the generator as it stood at 9118ea7, before solid mode
 * existed, so siesta output can be held byte-for-byte against them.
 */
export const GOLDEN_TIME = new Date('2026-10-15T12:00:00Z')

export const NON_DEFAULT: ScheduleState = {
  sunrise: { startMinute: 330, durationMinutes: 20, steps: 6 },
  sunset:  { startMinute: 1005, durationMinutes: 25, steps: 5 },
  cycle: {
    wrgbDuration: 45, spotlightDuration: 25, overlapMinutes: 3,
    cycleStart: 350, cycleEnd: 1005,
  },
  wrgbChannels:        { r: 55, g: 35, b: 0, w: 70 },
  spotlightBrightness: 45,
  ppfdWrgb:            120,
  ppfdSpotlight:       80,
}
