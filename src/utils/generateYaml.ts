import type { Light, LightConfig, RampScheduleState } from '../types'
import { rampEvents, spotWindows } from './ramp'

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

function spotAuto(
  id: string, alias: string, desc: string, at: number,
  entityId: string, brightness?: number,
): string {
  const lines = autoHeader(id, alias, desc, at)
  if (brightness === undefined) {
    lines.push(
      `    - action: light.turn_off`,
      `      target:`,
      `        entity_id: ${entityId}`,
    )
  } else {
    lines.push(
      `    - action: light.turn_on`,
      `      target:`,
      `        entity_id: ${entityId}`,
      `      data:`,
      `        brightness_pct: ${brightness}`,
    )
  }
  return lines.join('\n')
}

// ── Generator: ramp up, held peak, ramp down, optional spotlight ─────────────

export function generateRampYaml(state: RampScheduleState, light: Light): string {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw } = state
  const { r, g, b, w } = peakRgbw
  const { prefix, aliasPrefix, transport } = light
  const step = Math.max(1, state.stepMinutes)
  const autos: { at: number; text: string }[] = []

  for (const { phase, at, frac } of rampEvents(state)) {
    const id  = `${prefix}ramp_${phase}_${pad(at / 60)}${pad(at % 60)}`
    const tag = `${aliasPrefix} — Ramp ${phase === 'up' ? 'Up' : 'Down'} ${toTime(at).slice(0, 5)}`
    if (phase === 'down' && frac === 0) {
      autos.push({ at, text: rampAuto(id, `${tag} (0%)`, 'RGBW off', at, 'OFF', 0, 0, 0, 0, transport) })
    } else {
      const rv = clamp(r * frac), gv = clamp(g * frac), bv = clamp(b * frac), wv = clamp(w * frac)
      autos.push({ at, text: rampAuto(
        id, `${tag} (${Math.round(frac * 100)}%)`, `RGBW ${rv},${gv},${bv},${wv}`,
        at, 'ON', rv, gv, bv, wv, transport,
      ) })
    }
  }

  const spot = light.spotlight
  const windows = spotWindows(light, state)
  if (spot) {
    const pct = state.spotlightBrightness ?? 100
    const [[dawnOn, dawnOff], [duskOn, duskOff]] = windows
    autos.push(
      { at: dawnOn, text: spotAuto(`${prefix}spotlight_dawn_on`, `${aliasPrefix} — Spotlight Dawn On`,
          `Spotlight on ${state.spotlightLeadMinutes ?? 0}min before ramp up`, dawnOn, spot.entityId, pct) },
      { at: dawnOff, text: spotAuto(`${prefix}spotlight_dawn_off`, `${aliasPrefix} — Spotlight Dawn Off`,
          'Spotlight off at peak start', dawnOff, spot.entityId) },
      { at: duskOn, text: spotAuto(`${prefix}spotlight_dusk_on`, `${aliasPrefix} — Spotlight Dusk On`,
          'Spotlight on at peak end', duskOn, spot.entityId, pct) },
      { at: duskOff, text: spotAuto(`${prefix}spotlight_dusk_off`, `${aliasPrefix} — Spotlight Dusk Off`,
          `Spotlight off ${state.spotlightTailMinutes ?? 0}min after ramp down`, duskOff, spot.entityId) },
    )
  }

  // Stable: same-minute entries keep WRGB before spotlight.
  autos.sort((a, b) => a.at - b.at)

  const hm = (m: number) => toTime(m).slice(0, 5)
  const header = [
    `# ${light.header.title}`,
    `# Generated: ${generatedAt()}`,
    `#`,
    `# ${light.header.lampLabel}: ${lightDescription(transport)}`,
    ...(spot ? [`# Spotlight  : ${spot.entityId} at ${state.spotlightBrightness ?? 100}%`] : []),
    `#`,
    `# Ramp up    : ${hm(rampUpStart)} → ${hm(peakStart)} (${step}min steps)`,
    `# Peak hold  : ${hm(peakStart)} – ${hm(peakEnd)} at R=${r} G=${g} B=${b} W=${w}`,
    `# Ramp down  : ${hm(peakEnd)} → ${hm(rampDownEnd)} (${step}min steps)`,
    `# Off        : ${hm(rampDownEnd)} – ${hm(rampUpStart)} (RGBW 0,0,0,0)`,
    ...(spot ? [`# Spotlight  : ${windows.map(([a, b]) => `${hm(a)} – ${hm(b)}`).join(' and ')}`] : []),
    ``,
  ].join('\n')

  return header + autos.map(a => a.text).join('\n\n') + '\n'
}
