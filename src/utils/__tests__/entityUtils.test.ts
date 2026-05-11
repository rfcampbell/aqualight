import { describe, it, expect } from 'vitest'
import { pickPrimarySwitchEntity } from '../entityUtils'
import type { Entity } from '../entityUtils'

describe('pickPrimarySwitchEntity', () => {
  // ── Rejection tests ──────────────────────────────────────────────────────

  it('rejects _auto_off_enabled entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.unnamed_p316m_co2_auto_off_enabled' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _auto_update_enabled entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.device_auto_update_enabled' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _led entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.strip_led' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _power_protection entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.outlet_power_protection' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _overheat_protection entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.strip_overheat_protection' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _undervoltage_protection entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.strip_undervoltage_protection' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects _overcurrent_protection entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.strip_overcurrent_protection' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('rejects generic _[word]_enabled$ pattern', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.device_some_feature_enabled' },
      { entity_id: 'switch.gadget_child_lock_enabled' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('returns null when all candidates are feature toggles', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.plug_auto_off_enabled' },
      { entity_id: 'switch.plug_led' },
      { entity_id: 'switch.plug_power_protection' },
    ]
    expect(pickPrimarySwitchEntity(candidates)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(pickPrimarySwitchEntity([])).toBeNull()
  })

  // ── Selection / preference tests ─────────────────────────────────────────

  it('returns the sole non-toggle candidate', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.plug_auto_off_enabled' },
      { entity_id: 'switch.nano_co2', friendly_name: 'Nano CO2' },
    ]
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.nano_co2')
  })

  it('prefers clean name over auto-generated unnamed entity', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.unnamed_p316m_switch_1', friendly_name: 'Unnamed P316M Switch 1' },
      { entity_id: 'switch.nano_co2', friendly_name: 'Nano CO2' },
    ]
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.nano_co2')
  })

  it('prefers clean name over numeric-suffixed entity', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.smart_wi_fi_power_strip_switch_1' },
      { entity_id: 'switch.nano_lamp', friendly_name: 'Nano Lamp' },
    ]
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.nano_lamp')
  })

  it('prefers outlet device_class when names are equivalent', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.device_a' },
      { entity_id: 'switch.device_b', original_device_class: 'outlet' },
    ]
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.device_b')
  })

  it('among equal-score candidates, preserves input order', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.nano_heater', friendly_name: 'Nano Heater' },
      { entity_id: 'switch.nano_filter', friendly_name: 'Nano Filter' },
    ]
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.nano_heater')
  })

  it('handles real-world mix: p316m strip with toggles + clean entities', () => {
    const candidates: Entity[] = [
      { entity_id: 'switch.unnamed_p316m_co2_auto_off_enabled' },
      { entity_id: 'switch.unnamed_p316m_switch_1', friendly_name: 'Unnamed Switch 1' },
      { entity_id: 'switch.nano_co2', friendly_name: 'Nano CO2' },
      { entity_id: 'switch.nano_filter', friendly_name: 'Nano Filter' },
    ]
    // Both nano entities are clean; nano_co2 comes first
    expect(pickPrimarySwitchEntity(candidates)?.entity_id).toBe('switch.nano_co2')
  })
})
