import type { ScheduleState } from '../types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number) { return String(Math.floor(n)).padStart(2, '0') }

function toTime(minute: number): string {
  return `${pad(minute / 60)}:${pad(minute % 60)}:00`
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)))
}

function mqttPayload(state: 'ON' | 'OFF', r = 0, g = 0, b = 0, w = 0): string {
  if (state === 'OFF') return '\'{"state":"OFF"}\''
  return `'{"state":"ON","red":${r},"green":${g},"blue":${b},"white":${w}}'`
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

function fmtAuto(a: Auto): string {
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
    lines.push(
      `    - service: mqtt.publish`,
      `      data:`,
      `        topic: chihiros/light/set`,
      `        payload: ${mqttPayload(state, r, g, b, w)}`,
    )
  }

  if (a.actions.spot) {
    const { state, brightness = 100 } = a.actions.spot
    if (state === 'ON') {
      lines.push(
        `    - service: light.turn_on`,
        `      target:`,
        `        entity_id: light.aquarium_spotlight`,
        `      data:`,
        `        brightness_pct: ${brightness}`,
      )
    } else {
      lines.push(
        `    - service: light.turn_off`,
        `      target:`,
        `        entity_id: light.aquarium_spotlight`,
      )
    }
  }

  return lines.join('\n')
}

// ── Main generator ───────────────────────────────────────────────────────────

export function generateYaml(state: ScheduleState): string {
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

      // WRGB phase start — turn WRGB on, spotlight off
      autos.push({
        id:          `aquarium_cycle_${cycleNum}_wrgb_on`,
        alias:       `Aquarium — Cycle ${cycleNum} WRGB On`,
        description: `Cycle ${cycleNum}: WRGB on, spotlight off`,
        at:          cursor,
        actions: {
          wrgb: { state: 'ON', r, g, b, w },
          spot: cycleNum > 1 ? { state: 'OFF' } : undefined,  // spotlight already off at start
        },
      })

      // Overlap start — spotlight joins while WRGB still on
      if (overlapAt < end) {
        autos.push({
          id:          `aquarium_cycle_${cycleNum}_overlap_start`,
          alias:       `Aquarium — Cycle ${cycleNum} Spotlight Joins`,
          description: `Cycle ${cycleNum}: spotlight on (${cycle.overlapMinutes}min overlap begins)`,
          at:          overlapAt,
          actions: { spot: { state: 'ON', brightness: spotlightBrightness } },
        })
      }

      // WRGB phase end — WRGB off (skip if this is the last block; sunset ramp takes over)
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

      // Overlap start — WRGB rejoins while spotlight still on
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
    `# WRGB lamp  : MQTT topic chihiros/light/set`,
    `# Spotlight  : light.aquarium_spotlight`,
    `#`,
    `# Schedule   : Sunrise ${toTime(sunrise.startMinute)} (${sunrise.steps} steps, ${sunrise.durationMinutes}min)`,
    `#               Cycle ${toTime(cycle.cycleStart)}–${toTime(cycle.cycleEnd)} | WRGB ${cycle.wrgbDuration}min / Spotlight ${cycle.spotlightDuration}min / ${cycle.overlapMinutes}min overlap`,
    `#               Sunset ${toTime(sunset.startMinute)} (${sunset.steps} steps, ${sunset.durationMinutes}min)`,
    `#               Off at ${toTime(sunset.startMinute + sunset.durationMinutes)}`,
    ``,
  ].join('\n')

  return header + autos.map(fmtAuto).join('\n\n') + '\n'
}
