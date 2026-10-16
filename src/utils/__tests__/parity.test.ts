import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateRampYaml } from '../generateYaml'
import { normalizeState } from '../normalizeState'
import { lightById } from '../../lights'

/**
 * The 100P's move from solid mode to the ramp model, checked against what HA
 * was actually running: the aquarium_ entries and the AQUALIGHT_STATE snapshot
 * copied from robix's automations.yaml on 2026-10-16.
 *
 * The ramp generator lands each WRGB step one step later than solid mode did
 * (peak reached at peakStart, off at rampDownEnd). That shift is the only
 * intended difference, and it is pinned here exactly.
 */

const BIOTOPE = lightById('biotope')!
const fixture = (name: string) => readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8')
const LIVE_YAML     = fixture('live-aquarium-2026-10-16.yaml')
const LIVE_SNAPSHOT = JSON.parse(fixture('live-aquarium-snapshot-2026-10-16.json'))

type Commands = Map<string, Map<string, string>>  // HH:MM → entity → 'on N' | 'off'

/** Every light command, by trigger time. Ids and aliases are ignored on purpose. */
function commandsByTime(yaml: string): Commands {
  const out: Commands = new Map()
  for (const b of yaml.split(/^- id: /m).slice(1)) {
    const at = b.match(/at: '(\d\d:\d\d):00'/)![1]
    const cmds = out.get(at) ?? new Map<string, string>()
    for (const m of b.matchAll(/action: light\.turn_(on|off)\s+target:\s+entity_id: (\S+)(?:\s+data:\s+brightness_pct: (\d+))?/g))
      setOnce(cmds, m[2], m[1] === 'on' ? `on ${m[3]}` : 'off', at)
    out.set(at, cmds)
  }
  return out
}

/** Two commands for one entity at one minute would race in HA; same command twice is harmless. */
function setOnce(cmds: Map<string, string>, entity: string, cmd: string, at: string) {
  const prior = cmds.get(entity)
  if (prior !== undefined && prior !== cmd) throw new Error(`${at} ${entity}: ${prior} vs ${cmd}`)
  cmds.set(entity, cmd)
}

const plain = (c: Commands) =>
  Object.fromEntries([...c].filter(([, m]) => m.size).sort().map(([t, m]) => [t, Object.fromEntries([...m].sort())]))

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

describe('100P parity with the live solid schedule', () => {
  const converted = normalizeState(BIOTOPE, LIVE_SNAPSHOT)

  it('the live snapshot converts to exactly the registry defaults', () => {
    expect(converted).toEqual(BIOTOPE.defaults)
  })

  it('live fixture is the 24 automations HA was running', () => {
    expect(LIVE_YAML.match(/^- id: /gm)).toHaveLength(24)
  })

  it('regenerates the live times and actions, WRGB ramps shifted one 3-min step later', () => {
    const live = commandsByTime(LIVE_YAML)
    const next = commandsByTime(generateRampYaml(converted!, BIOTOPE))
    const isWrgb = (e: string) => e.startsWith('light.dywpr120fa39f25d91a7_')

    // Live with only the intended change applied.
    const expected: Commands = new Map()
    const put = (t: string, e: string, c: string) => {
      const m = expected.get(t) ?? new Map<string, string>()
      setOnce(m, e, c, t)
      expected.set(t, m)
    }
    for (const [t, cmds] of live) {
      for (const [e, c] of cmds) {
        const m = mins(t)
        const inRamp = (m >= 345 && m <= 372) || (m >= 795 && m <= 822)
        if (!isWrgb(e))       put(t, e, c)              // spotlight: unchanged
        else if (inRamp)      put(hhmm(m + 3), e, c)    // ramp steps: one step later
        else if (t === '14:00') continue                // WRGB already off since 13:45
        else                  put(t, e, c)
      }
    }
    // Ramp down now opens at full; a no-op after the held peak.
    for (const c of ['red', 'green', 'blue', 'white']) put('13:15', `light.dywpr120fa39f25d91a7_${c}`, 'on 60')

    expect(plain(next)).toEqual(plain(expected))
  })

  it('spotlight commands are identical to live', () => {
    const spot = (c: Commands) => plain(new Map([...c].map(([t, m]) =>
      [t, new Map([...m].filter(([e]) => e === 'light.aquarium_spotlight'))])))
    expect(spot(commandsByTime(generateRampYaml(converted!, BIOTOPE)))).toEqual(spot(commandsByTime(LIVE_YAML)))
  })
})
