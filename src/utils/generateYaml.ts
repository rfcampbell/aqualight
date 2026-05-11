import type { ScheduleState, NanoScheduleState } from '../types'

// ── Light configuration ──────────────────────────────────────────────────────

/**
 * Discriminated union of how a WRGB light's automations should be emitted.
 *
 * - `mqtt`: flat 0-100 channel payload via mqtt.publish. Used by the
 *   chihiros-mqtt bridge (nano, and the legacy 100P shape).
 * - `ha_light`: single HA light entity, rgbw_color 0-255. Useful for any
 *   integration that exposes one RGBW entity per lamp.
 * - `light_entities`: four HA light entities, one per RGBW channel, each
 *   driven with brightness_pct 0-100. Used by chihiros-led-control (HACS),
 *   which is what the 100P now uses via ESP32 Bluetooth Proxy.
 */
export type LightConfig =
  | { kind: 'mqtt';           entityId: string; topic: string }
  | { kind: 'ha_light';       entityId: string }
  | {
      kind: 'light_entities'
      entityIds: { red: string; green: string; blue: string; white: string }
    }

export const BIOTOPE_LIGHT_CONFIG: LightConfig = {
  kind: 'light_entities',
  entityIds: {
    red:   'light.dywpr120fa39f25d91a7_red',
    green: 'light.dywpr120fa39f25d91a7_green',
    blue:  'light.dywpr120fa39f25d91a7_blue',
    white: 'light.dywpr120fa39f25d91a7_white',
  },
}

export const NANO_LIGHT_CONFIG: LightConfig = {
  kind: 'mqtt',
  entityId: 'light.chihiros_nano_wrgb',
  topic:    'chihiros/nano/light/set',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(Math.floor(n)).padStart(2, '0') }

function toTime(minute: number): string {
  return `${pad(minute / 60)}:${pad(minute % 60)}:00`
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)))
}

function to255(v: number): number {
  return Math.round(v * 2.55)
}

function mqttPayload(state: 'ON' | 'OFF', r = 0, g = 0, b = 0, w = 0): string {
  if (state === 'OFF') return '\'{"state":"OFF"}\''
  return `'{"state":"ON","red":${r},"green":${g},"blue":${b},"white":${w}}'`
}

function lightDescription(cfg: LightConfig): string {
  switch (cfg.kind) {
    case 'mqtt':           return `MQTT topic ${cfg.topic}`
    case 'ha_light':       return `HA entity ${cfg.entityId}`
    case 'light_entities': {
      const { red, green, blue, white } = cfg.entityIds
      return `HA entities r=${red} g=${green} b=${blue} w=${white}`
    }
  }
}

// ── Automation builder ───────────────────────────────────────────────────────

interface AutoAction {
  wrgb?: { state: 'ON' | 'OFF'; r?: number; g?: number; b?: number; w?: number }
  spot?: { state: 'ON' | 'OFF'; brightness?: number }
}

interface Auto {
  id: string
  alias: string
  description: string
  at: number  // minute of day
  actions: AutoAction
}

function fmtWrgbAction(
  state: 'ON' | 'OFF',
  r: number, g: number, b: number, w: number,
  cfg: LightConfig,
): string[] {
  switch (cfg.kind) {
    case 'mqtt':
      return [
        `    - service: mqtt.publish`,
        `      data:`,
        `        topic: ${cfg.topic}`,
        `        payload: ${mqttPayload(state, r, g, b, w)}`,
      ]

    case 'ha_light':
      if (state === 'OFF') {
        return [
          `    - action: light.turn_off`,
          `      target:`,
          `        entity_id: ${cfg.entityId}`,
        ]
      }
      return [
        `    - action: light.turn_on`,
        `      target:`,
        `        entity_id: ${cfg.entityId}`,
        `      data:`,
        `        rgbw_color: [${to255(r)}, ${to255(g)}, ${to255(b)}, ${to255(w)}]`,
      ]

    case 'light_entities': {
      const channels: Array<['red' | 'green' | 'blue' | 'white', number]> = [
        ['red', r], ['green', g], ['blue', b], ['white', w],
      ]
      const lines: string[] = []
      for (const [channel, value] of channels) {
        const entity = cfg.entityIds[channel]
        if (state === 'OFF' || value <= 0) {
          lines.push(
            `    - action: light.turn_off`,
            `      target:`,
            `        entity_id: ${entity}`,
          )
        } else {
          lines.push(
            `    - action: light.turn_on`,
            `      target:`,
            `        entity_id: ${entity}`,
            `      data:`,
            `        brightness_pct: ${value}`,
          )
        }
      }
      return lines
    }
  }
}

function fmtAuto(a: Auto, cfg: LightConfig): string {
  const lines: string[] = [
    `- id: '${a.id}'`,
    `  alias: '${a.alias}'`,
    `  description: '${a.description}'`,
    `  mode: single`,
    `  trigger:`,
    `    - platform: time`,
    `      at: '${toTime(a.at)}'`,
    `  action:`,
  ]

  if (a.actions.wrgb) {
    const { state, r = 0, g = 0, b = 0, w = 0 } = a.actions.wrgb
    lines.push(...fmtWrgbAction(state, r, g, b, w, cfg))
  }

  if (a.actions.spot) {
    const { state, brightness = 100 } = a.actions.spot
    if (state === 'ON') {
      lines.push(
        `    - action: light.turn_on`,
        `      target:`,
        `        entity_id: light.aquarium_spotlight`,
        `      data:`,
        `        brightness_pct: ${brightness}`,
      )
    } else {
      lines.push(
        `    - action: light.turn_off`,
        `      target:`,
        `        entity_id: light.aquarium_spotlight`,
      )
    }
  }

  return lines.join('\n')
}

// ── Main generator ───────────────────────────────────────────────────────────

export function generateYaml(state: ScheduleState, cfg: LightConfig = BIOTOPE_LIGHT_CONFIG): string {
  const { sunrise, sunset, cycle, wrgbChannels, spotlightBrightness } = state
  const { r, g, b, w } = wrgbChannels
  const autos: Auto[] = []

  // ── Sunrise ramp: N steps, each at fraction of full channel values ─────────
  const sunriseStepDur = sunrise.durationMinutes / sunrise.steps
  for (let i = 1; i <= sunrise.steps; i++) {
    const frac = i / sunrise.steps
    autos.push({
      id:          `aquarium_sunrise_step_${i}`,
      alias:       `Aquarium — Sunrise ${i}/${sunrise.steps}`,
      description: `WRGB to ${Math.round(frac * 100)}% (sunrise ramp)`,
      at:          sunrise.startMinute + (i - 1) * sunriseStepDur,
      actions: {
        wrgb: { state: 'ON', r: clamp(r * frac), g: clamp(g * frac), b: clamp(b * frac), w: clamp(w * frac) },
      },
    })
  }

  // ── Cycling transitions ───────────────────────────────────────────────────
  let cursor = cycle.cycleStart
  let isWrgb = true
  let cycleNum = 1

  while (cursor < cycle.cycleEnd) {
    if (isWrgb) {
      const end         = Math.min(cursor + cycle.wrgbDuration, cycle.cycleEnd)
      const overlapAt   = Math.max(cursor, end - cycle.overlapMinutes)
      const isLastBlock = end >= cycle.cycleEnd

      autos.push({
        id:          `aquarium_cycle_${cycleNum}_wrgb_on`,
        alias:       `Aquarium — Cycle ${cycleNum} WRGB On`,
        description: `Cycle ${cycleNum}: WRGB on, spotlight off`,
        at:          cursor,
        actions: {
          wrgb: { state: 'ON', r, g, b, w },
          spot: cycleNum > 1 ? { state: 'OFF' } : undefined,
        },
      })

      if (overlapAt < end) {
        autos.push({
          id:          `aquarium_cycle_${cycleNum}_overlap_start`,
          alias:       `Aquarium — Cycle ${cycleNum} Spotlight Joins`,
          description: `Cycle ${cycleNum}: spotlight on (${cycle.overlapMinutes}min overlap begins)`,
          at:          overlapAt,
          actions: { spot: { state: 'ON', brightness: spotlightBrightness } },
        })
      }

      if (!isLastBlock) {
        autos.push({
          id:          `aquarium_cycle_${cycleNum}_wrgb_off`,
          alias:       `Aquarium — Cycle ${cycleNum} WRGB Off`,
          description: `Cycle ${cycleNum}: WRGB off, spotlight continues`,
          at:          end,
          actions: { wrgb: { state: 'OFF' } },
        })
      }

      cursor = end
    } else {
      const end        = Math.min(cursor + cycle.spotlightDuration, cycle.cycleEnd)
      const overlapAt  = Math.max(cursor, end - cycle.overlapMinutes)

      if (overlapAt < end) {
        autos.push({
          id:          `aquarium_cycle_${cycleNum}_wrgb_returns`,
          alias:       `Aquarium — Cycle ${cycleNum} WRGB Returns`,
          description: `Cycle ${cycleNum}: WRGB on (${cycle.overlapMinutes}min overlap begins)`,
          at:          overlapAt,
          actions: { wrgb: { state: 'ON', r, g, b, w } },
        })
      }

      cursor = end
      cycleNum++
    }

    isWrgb = !isWrgb
    if (cursor >= cycle.cycleEnd) break
  }

  // ── Sunset ramp: N steps stepping down ───────────────────────────────────
  const sunsetStepDur = sunset.durationMinutes / sunset.steps
  for (let i = 0; i < sunset.steps; i++) {
    const frac = 1 - (i + 1) / sunset.steps
    const at   = sunset.startMinute + i * sunsetStepDur
    autos.push({
      id:          `aquarium_sunset_step_${i + 1}`,
      alias:       `Aquarium — Sunset ${i + 1}/${sunset.steps}`,
      description: `WRGB to ${Math.round(frac * 100)}% (sunset ramp)`,
      at,
      actions: frac > 0
        ? { wrgb: { state: 'ON', r: clamp(r * frac), g: clamp(g * frac), b: clamp(b * frac), w: clamp(w * frac) } }
        : { wrgb: { state: 'OFF' } },
    })
  }

  // ── Final off ─────────────────────────────────────────────────────────────
  autos.push({
    id:          'aquarium_lights_off',
    alias:       'Aquarium — Lights Off',
    description: 'All aquarium lights off for the night',
    at:          sunset.startMinute + sunset.durationMinutes,
    actions:     { wrgb: { state: 'OFF' }, spot: { state: 'OFF' } },
  })

  // ── Sort and render ───────────────────────────────────────────────────────
  autos.sort((a, b) => a.at - b.at)

  const header = [
    `# AquaLight — Home Assistant automations`,
    `# Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    `#`,
    `# WRGB lamp  : ${lightDescription(cfg)}`,
    `# Spotlight  : light.aquarium_spotlight`,
    `#`,
    `# Schedule   : Sunrise ${toTime(sunrise.startMinute)} (${sunrise.steps} steps, ${sunrise.durationMinutes}min)`,
    `#               Cycle ${toTime(cycle.cycleStart)}–${toTime(cycle.cycleEnd)} | WRGB ${cycle.wrgbDuration}min / Spotlight ${cycle.spotlightDuration}min / ${cycle.overlapMinutes}min overlap`,
    `#               Sunset ${toTime(sunset.startMinute)} (${sunset.steps} steps, ${sunset.durationMinutes}min)`,
    `#               Off at ${toTime(sunset.startMinute + sunset.durationMinutes)}`,
    ``,
  ].join('\n')

  return header + autos.map(a => fmtAuto(a, cfg)).join('\n\n') + '\n'
}

// ── Nano (Chihiros WRGB II Pro) ramp generator ───────────────────────────────

function nanoAuto(
  id: string, alias: string, desc: string, at: number,
  r: number, g: number, b: number, w: number,
  cfg: LightConfig,
): string {
  const header = [
    `- id: '${id}'`,
    `  alias: '${alias}'`,
    `  description: '${desc}'`,
    `  mode: single`,
    `  trigger:`,
    `    - platform: time`,
    `      at: '${toTime(at)}'`,
    `  action:`,
  ]

  return [...header, ...fmtWrgbAction('ON', r, g, b, w, cfg)].join('\n')
}

function nanoOffAuto(id: string, alias: string, desc: string, at: number, cfg: LightConfig): string {
  const header = [
    `- id: '${id}'`,
    `  alias: '${alias}'`,
    `  description: '${desc}'`,
    `  mode: single`,
    `  trigger:`,
    `    - platform: time`,
    `      at: '${toTime(at)}'`,
    `  action:`,
  ]

  return [...header, ...fmtWrgbAction('OFF', 0, 0, 0, 0, cfg)].join('\n')
}

export function generateNanoYaml(state: NanoScheduleState, cfg: LightConfig = NANO_LIGHT_CONFIG): string {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw, stepMinutes } = state
  const { r, g, b, w } = peakRgbw
  const step = Math.max(1, stepMinutes)
  const autos: string[] = []

  // Ramp up: rampUpStart → peakStart (skip frac=0 — light is already off from prior night's turn_off)
  const upSteps = Math.round((peakStart - rampUpStart) / step)
  for (let i = 0; i <= upSteps; i++) {
    const t    = rampUpStart + i * step
    const frac = upSteps > 0 ? i / upSteps : 1
    if (frac === 0) continue
    const rv = clamp(r * frac), gv = clamp(g * frac), bv = clamp(b * frac), wv = clamp(w * frac)
    autos.push(nanoAuto(
      `nano_ramp_up_${pad(t / 60)}${pad(t % 60)}`,
      `Nano — Ramp Up ${toTime(t).slice(0, 5)} (${Math.round(frac * 100)}%)`,
      `RGBW ${rv},${gv},${bv},${wv}`,
      t, rv, gv, bv, wv, cfg,
    ))
  }

  // Ramp down: peakEnd → rampDownEnd
  const downSteps = Math.round((rampDownEnd - peakEnd) / step)
  for (let i = 0; i <= downSteps; i++) {
    const t    = peakEnd + i * step
    if (t === peakStart) continue
    const frac = downSteps > 0 ? 1 - i / downSteps : 0
    const rv = clamp(r * frac), gv = clamp(g * frac), bv = clamp(b * frac), wv = clamp(w * frac)

    if (frac === 0) {
      autos.push(nanoOffAuto(
        `nano_ramp_down_${pad(t / 60)}${pad(t % 60)}`,
        `Nano — Ramp Down ${toTime(t).slice(0, 5)} (0%)`,
        `RGBW off`,
        t, cfg,
      ))
    } else {
      autos.push(nanoAuto(
        `nano_ramp_down_${pad(t / 60)}${pad(t % 60)}`,
        `Nano — Ramp Down ${toTime(t).slice(0, 5)} (${Math.round(frac * 100)}%)`,
        `RGBW ${rv},${gv},${bv},${wv}`,
        t, rv, gv, bv, wv, cfg,
      ))
    }
  }

  const header = [
    `# AquaLight — Nano (Chihiros WRGB II Pro · UNS 45U) automations`,
    `# Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    `#`,
    `# WRGB II Pro : ${lightDescription(cfg)}`,
    `#`,
    `# Ramp up    : ${toTime(rampUpStart).slice(0, 5)} → ${toTime(peakStart).slice(0, 5)} (${step}min steps)`,
    `# Peak hold  : ${toTime(peakStart).slice(0, 5)} – ${toTime(peakEnd).slice(0, 5)} at R=${r} G=${g} B=${b} W=${w}`,
    `# Ramp down  : ${toTime(peakEnd).slice(0, 5)} → ${toTime(rampDownEnd).slice(0, 5)} (${step}min steps)`,
    `# Off        : ${toTime(rampDownEnd).slice(0, 5)} – ${toTime(rampUpStart).slice(0, 5)} (RGBW 0,0,0,0)`,
    ``,
  ].join('\n')

  return header + autos.join('\n\n') + '\n'
}
