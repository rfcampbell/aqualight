import type { Light, RampScheduleState } from '../types'
import { normalizeState } from './normalizeState'

/**
 * Per-light browser storage: the whole schedule under the light's key.
 * Stored state that no longer fits (the 100P's old two-field defaults,
 * siesta) loads as null and is removed, so it cannot come back.
 */

export function loadStored(light: Light): RampScheduleState | null {
  try {
    const raw = localStorage.getItem(light.storage.key)
    if (!raw) return null
    const state = normalizeState(light, JSON.parse(raw))
    if (!state) localStorage.removeItem(light.storage.key)
    return state
  } catch { return null }
}

export function saveStored(light: Light, state: RampScheduleState): void {
  try {
    localStorage.setItem(light.storage.key, JSON.stringify(state))
  } catch { /* private mode or quota — nothing to recover, HA holds the real state */ }
}
