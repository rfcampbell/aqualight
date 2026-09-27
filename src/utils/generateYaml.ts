import type {
  ScheduleState, NanoScheduleState, Light, SiestaLight, RampLight, LightConfig,
} from '../types'

export type { LightConfig }

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

function generatedAt(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

// ── Channel emitters ─────────────────────────────────────────────────────────
// One emitter per transport, shared by every light that declares it.

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

function autoHeader(id: string, alias: string, desc: string, at: number): string[] {
  return [
    `- id: '${id}'`,
    `  alias: '${alias}'`,
    `  description: '${desc}'`,
    `  mode: single`,
    `  trigger:`,
    `    - platform: time`,
    `      at: '${toTime(at)}'`,
    `  action:`,
  ]
}

function fmtAuto(a: Auto, light: SiestaLight): string {
  const lines = autoHeader(a.id, a.alias, a.description, a.at)

  if (a.actions.wrgb) {
    const { state, r = 0, g = 0, b = 0, w = 0 } = a.actions.wrgb
    lines.push(...fmtWrgbAction(state, r, g, b, w, light.transport))
  }

  // Skipped entirely for a light with no spotlight.
  if (a.actions.spot && light.spotlight) {
    const { state, brightness = 100 } = a.actions.spot
    if (state === 'ON') {
      lines.push(
        `    - action: light.turn_on`,
        `      target:`,
        `        entity_id: ${light.spotlight.entityId}`,
        `      data:`,
        `        brightness_pct: ${brightness}`,
      )
    } else {
      lines.push(
        `    - action: light.turn_off`,
        `      target:`,
        `        entity_id: ${light.spotlight.entityId}`,
      )
    }
  }

  return lines.join('\n')
}

// ── Siesta generator (cycling WRGB with optional spotlight fill) ─────────────

export function generateYaml(state: ScheduleState, light: SiestaLight): string {
  const { sunrise, sunset, cycle, wrgbChannels, spotlightBrightness } = state
  const { r, g, b, w } = wrgbChannels
  const { prefix, aliasPrefix } = light
  const autos: Auto[] = []

  // ── Sunrise ramp: N steps, each at fraction of full channel values ─────────
  const sunriseStepDur = sunrise.durationMinutes / sunrise.steps
  for (let i = 1; i <= sunrise.steps; i++) {
    const frac = i / sunrise.steps
    autos.push({
      id:          `${prefix}sunrise_step_${i}`,
      alias:       `${aliasPrefix} — Sunrise ${i}/${sunrise.steps}`,
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
        id:          `${prefix}cycle_${cycleNum}_wrgb_on`,
        alias:       `${aliasPrefix} — Cycle ${cycleNum} WRGB On`,
        description: `Cycle ${cycleNum}: WRGB on, spotlight off`,
        at:          cursor,
        actions: {
          wrgb: { state: 'ON', r, g, b, w },
          spot: cycleNum > 1 ? { state: 'OFF' } : undefined,
        },
      })

      if (overlapAt < end) {
        autos.push({
          id:          `${prefix}cycle_${cycleNum}_overlap_start`,
          alias:       `${aliasPrefix} — Cycle ${cycleNum} Spotlight Joins`,
          description: `Cycle ${cycleNum}: spotlight on (${cycle.overlapMinutes}min overlap begins)`,
          at:          overlapAt,
          actions: { spot: { state: 'ON', brightness: spotlightBrightness } },
        })
      }

      if (!isLastBlock) {
        autos.push({
          id:          `${prefix}cycle_${cycleNum}_wrgb_off`,
          alias:       `${aliasPrefix} — Cycle ${cycleNum} WRGB Off`,
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
          id:          `${prefix}cycle_${cycleNum}_wrgb_returns`,
          alias:       `${aliasPrefix} — Cycle ${cycleNum} WRGB Returns`,
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
      id:          `${prefix}sunset_step_${i + 1}`,
      alias:       `${aliasPrefix} — Sunset ${i + 1}/${sunset.steps}`,
      description: `WRGB to ${Math.round(frac * 100)}% (sunset ramp)`,
      at,
      actions: frac > 0
        ? { wrgb: { state: 'ON', r: clamp(r * frac), g: clamp(g * frac), b: clamp(b * frac), w: clamp(w * frac) } }
        : { wrgb: { state: 'OFF' } },
    })
  }

  // ── Final off ─────────────────────────────────────────────────────────────
  autos.push({
    id:          `${prefix}lights_off`,
    alias:       `${aliasPrefix} — Lights Off`,
    description: 'All aquarium lights off for the night',
    at:          sunset.startMinute + sunset.durationMinutes,
    actions:     { wrgb: { state: 'OFF' }, spot: { state: 'OFF' } },
  })

  // ── Sort and render ───────────────────────────────────────────────────────
  autos.sort((a, b) => a.at - b.at)

  const headerLines = [
    `# ${light.header.title}`,
    `# Generated: ${generatedAt()}`,
    `#`,
    `# ${light.header.lampLabel}: ${lightDescription(light.transport)}`,
  ]
  if (light.spotlight) {
    headerLines.push(`# Spotlight  : ${light.spotlight.entityId}`)
  }
  headerLines.push(
    `#`,
    `# Schedule   : Sunrise ${toTime(sunrise.startMinute)} (${sunrise.steps} steps, ${sunrise.durationMinutes}min)`,
    `#               Cycle ${toTime(cycle.cycleStart)}–${toTime(cycle.cycleEnd)} | WRGB ${cycle.wrgbDuration}min / Spotlight ${cycle.spotlightDuration}min / ${cycle.overlapMinutes}min overlap`,
    `#               Sunset ${toTime(sunset.startMinute)} (${sunset.steps} steps, ${sunset.durationMinutes}min)`,
    `#               Off at ${toTime(sunset.startMinute + sunset.durationMinutes)}`,
    ``,
  )

  return headerLines.join('\n') + autos.map(a => fmtAuto(a, light)).join('\n\n') + '\n'
}

// ── Ramp generator (single peak with sunrise/sunset ramps) ────────────────────

function rampAuto(
  id: string, alias: string, desc: string, at: number,
  state: 'ON' | 'OFF',
  r: number, g: number, b: number, w: number,
  cfg: LightConfig,
): string {
  return [
    ...autoHeader(id, alias, desc, at),
    ...fmtWrgbAction(state, r, g, b, w, cfg),
  ].join('\n')
}

export function generateNanoYaml(state: NanoScheduleState, light: RampLight): string {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw, stepMinutes } = state
  const { r, g, b, w } = peakRgbw
  const { prefix, aliasPrefix, transport } = light
  const step = Math.max(1, stepMinutes)
  const autos: string[] = []

  // Ramp up: rampUpStart → peakStart (skip frac=0 — light is already off from prior night's turn_off)
  const upSteps = Math.round((peakStart - rampUpStart) / step)
  for (let i = 0; i <= upSteps; i++) {
    const t    = rampUpStart + i * step
    const frac = upSteps > 0 ? i / upSteps : 1
    if (frac === 0) continue
    const rv = clamp(r * frac), gv = clamp(g * frac), bv = clamp(b * frac), wv = clamp(w * frac)
    autos.push(rampAuto(
      `${prefix}ramp_up_${pad(t / 60)}${pad(t % 60)}`,
      `${aliasPrefix} — Ramp Up ${toTime(t).slice(0, 5)} (${Math.round(frac * 100)}%)`,
      `RGBW ${rv},${gv},${bv},${wv}`,
      t, 'ON', rv, gv, bv, wv, transport,
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
      autos.push(rampAuto(
        `${prefix}ramp_down_${pad(t / 60)}${pad(t % 60)}`,
        `${aliasPrefix} — Ramp Down ${toTime(t).slice(0, 5)} (0%)`,
        `RGBW off`,
        t, 'OFF', 0, 0, 0, 0, transport,
      ))
    } else {
      autos.push(rampAuto(
        `${prefix}ramp_down_${pad(t / 60)}${pad(t % 60)}`,
        `${aliasPrefix} — Ramp Down ${toTime(t).slice(0, 5)} (${Math.round(frac * 100)}%)`,
        `RGBW ${rv},${gv},${bv},${wv}`,
        t, 'ON', rv, gv, bv, wv, transport,
      ))
    }
  }

  const header = [
    `# ${light.header.title}`,
    `# Generated: ${generatedAt()}`,
    `#`,
    `# ${light.header.lampLabel}: ${lightDescription(transport)}`,
    `#`,
    `# Ramp up    : ${toTime(rampUpStart).slice(0, 5)} → ${toTime(peakStart).slice(0, 5)} (${step}min steps)`,
    `# Peak hold  : ${toTime(peakStart).slice(0, 5)} – ${toTime(peakEnd).slice(0, 5)} at R=${r} G=${g} B=${b} W=${w}`,
    `# Ramp down  : ${toTime(peakEnd).slice(0, 5)} → ${toTime(rampDownEnd).slice(0, 5)} (${step}min steps)`,
    `# Off        : ${toTime(rampDownEnd).slice(0, 5)} – ${toTime(rampUpStart).slice(0, 5)} (RGBW 0,0,0,0)`,
    ``,
  ].join('\n')

  return header + autos.join('\n\n') + '\n'
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/** Generate a light's YAML using whichever generator its scheduleKind selects. */
export function generateLightYaml(light: Light, state: unknown): string {
  return light.scheduleKind === 'siesta'
    ? generateYaml(state as ScheduleState, light)
    : generateNanoYaml(state as NanoScheduleState, light)
}
