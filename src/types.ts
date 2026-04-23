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

