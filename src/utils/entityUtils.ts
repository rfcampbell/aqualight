export interface Entity {
  entity_id: string
  friendly_name?: string
  device_class?: string
  original_device_class?: string
}

// Patterns that identify feature-toggle entities, never primary switch targets
const REJECT_PATTERNS: RegExp[] = [
  /_auto_off_enabled$/,
  /_auto_update_enabled$/,
  /_led$/,
  /_power_protection$/,
  /_overheat_protection$/,
  /_undervoltage_protection$/,
  /_overcurrent_protection$/,
  // Generic: any entity_id ending in _<word(s)>_enabled
  /_[a-z_]+_enabled$/,
]

function isRejected(entity: Entity): boolean {
  return REJECT_PATTERNS.some(re => re.test(entity.entity_id))
}

/** True when entity_id looks like a clean, intentionally-named entity */
function hasCleanId(entity: Entity): boolean {
  // Reject auto-generated IDs with "unnamed_" prefix or trailing numeric suffixes like _1, _2
  if (/unnamed_/.test(entity.entity_id)) return false
  if (/_\d+$/.test(entity.entity_id)) return false
  return true
}

/** True when friendly_name looks user-set (no "Unnamed" or long model strings) */
function hasCleanName(entity: Entity): boolean {
  const name = entity.friendly_name ?? ''
  if (!name) return false
  if (/unnamed/i.test(name)) return false
  // Heuristic: suspiciously long auto-generated names have many words/hyphens
  if (name.split(/[\s\-_]/).length > 6) return false
  return true
}

function score(entity: Entity): number {
  let s = 0
  if (hasCleanId(entity))   s += 4
  if (hasCleanName(entity)) s += 3
  if (entity.original_device_class === 'outlet' || entity.device_class === 'outlet') s += 2
  return s
}

/**
 * From a list of switch entity candidates, return the best primary switch
 * entity, or null if none survive the reject filter.
 *
 * Selection rules (in priority order):
 *  1. Reject all feature-toggle entities (see REJECT_PATTERNS)
 *  2. Prefer clean custom name / clean entity_id over auto-generated ones
 *  3. Prefer outlet device_class
 *  4. Among ties, pick the first in the original order
 */
export function pickPrimarySwitchEntity(candidates: Entity[]): Entity | null {
  const eligible = candidates.filter(e => !isRejected(e))
  if (eligible.length === 0) return null

  // Stable sort: higher score first, preserve original order for ties
  const scored = eligible.map((e, i) => ({ e, s: score(e), i }))
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  return scored[0].e
}
