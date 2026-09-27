import type { Light } from '../types'

/**
 * Per-light browser storage. The key and the set of persisted fields are
 * registry fields, so each light keeps its own legacy key and its own legacy
 * notion of what "defaults" means — biotope has only ever stored channel
 * levels and spotlight brightness under aqualight_defaults, while nano stores
 * its whole state under aqualight_nano.
 */

export function loadStored(light: Light): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(light.storage.key)
    return raw ? JSON.parse(raw) as Record<string, unknown> : null
  } catch { return null }
}

export function saveStored(light: Light, state: Record<string, unknown>): void {
  const { fields } = light.storage
  const payload = fields
    ? Object.fromEntries(fields.filter(f => f in state).map(f => [f, state[f]]))
    : state
  try {
    localStorage.setItem(light.storage.key, JSON.stringify(payload))
  } catch { /* private mode or quota — nothing to recover, HA holds the real state */ }
}
