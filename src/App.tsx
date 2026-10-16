import { useEffect, useState } from 'react'
import type { RampScheduleState, Light } from './types'
import ParDliEstimator from './components/ParDliEstimator'
import YamlPanel from './components/YamlPanel'
import RampEditor from './components/RampEditor'
import RampDeviceTest from './components/RampDeviceTest'
import Presets from './components/Presets'
import { LIGHTS } from './lights'
import { loadStored, saveStored } from './utils/lightStorage'
import { normalizeState } from './utils/normalizeState'
import { generateRampYaml } from './utils/generateYaml'
import { rampProblems } from './utils/ramp'
import './App.css'

type HydrateSource = 'local' | 'ha' | 'offline'

/** This browser's saved schedule, or the registry defaults. */
function initialState(light: Light): RampScheduleState {
  return loadStored(light) ?? light.defaults
}

export default function App() {
  const [activeId, setActiveId] = useState<string>(LIGHTS[0].id)

  const [states, setStates] = useState<Record<string, RampScheduleState>>(() =>
    Object.fromEntries(LIGHTS.map(l => [l.id, initialState(l)])),
  )
  const [sources, setSources] = useState<Record<string, HydrateSource>>(() =>
    Object.fromEntries(LIGHTS.map(l => [l.id, 'local' as HydrateSource])),
  )

  // On mount, hydrate each light from the snapshot its last deploy left in
  // HA's automations.yaml. A snapshot that doesn't fit (siesta) is ignored.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(LIGHTS.map(l =>
        fetch(`/api/ha/state?prefix=${encodeURIComponent(l.prefix)}`)
          .then(r => r.json())
          .catch(() => null),
      ))
      if (cancelled) return

      // Every request dead means the API isn't reachable at all — say so rather
      // than silently showing local defaults as though they came from HA.
      if (results.every(r => r === null)) {
        setSources(Object.fromEntries(LIGHTS.map(l => [l.id, 'offline' as HydrateSource])))
        return
      }

      const nextStates: Record<string, RampScheduleState> = {}
      const nextSources: Record<string, HydrateSource> = {}
      LIGHTS.forEach((light, i) => {
        const res = results[i]
        const deployed = res?.exists ? normalizeState(light, res.state) : null
        if (deployed) {
          nextStates[light.id]  = deployed
          nextSources[light.id] = 'ha'
        } else if (res === null) {
          nextSources[light.id] = 'offline'
        }
      })
      if (Object.keys(nextStates).length)  setStates(s => ({ ...s, ...nextStates }))
      if (Object.keys(nextSources).length) setSources(s => ({ ...s, ...nextSources }))
    })()
    return () => { cancelled = true }
  }, [])

  const active = LIGHTS.find(l => l.id === activeId) ?? LIGHTS[0]

  function update(light: Light, next: RampScheduleState) {
    setStates(s => ({ ...s, [light.id]: next }))
    saveStored(light, next)
  }

  /** Returns an error message when the preset doesn't fit this light. */
  function handleLoadPreset(light: Light, loaded: unknown): string | null {
    const next = normalizeState(light, loaded)
    if (!next) return 'Not loaded: this preset is not a ramp schedule (siesta presets cannot be converted).'
    update(light, next)
    setSources(s => ({ ...s, [light.id]: 'local' }))
    return null
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <span className="app-logo-icon">◉</span>
            <h1 className="app-title">AquaLight</h1>
          </div>
          <div className="app-subtitle">Chihiros Schedule Editor</div>

          <div className="device-tabs">
            {LIGHTS.map(light => (
              <button
                key={light.id}
                className={`device-tab ${light.id === activeId ? 'device-tab--active' : ''}`}
                onClick={() => setActiveId(light.id)}
              >
                {light.label}
                {light.sublabel && <span className="device-tab-sub">{light.sublabel}</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="section">
          <Presets
            device={active.presetId}
            currentState={states[active.id]}
            source={sources[active.id]}
            onLoad={loaded => handleLoadPreset(active, loaded)}
          />
        </section>

        <LightPanels
          key={active.id}
          light={active}
          schedule={states[active.id]}
          onChange={next => update(active, next)}
        />
      </main>
    </div>
  )
}

function LightPanels({ light, schedule, onChange }: {
  light: Light
  schedule: RampScheduleState
  onChange: (s: RampScheduleState) => void
}) {
  return (
    <>
      <section className="section two-col" style={{ alignItems: 'start' }}>
        <RampEditor light={light} schedule={schedule} onChange={onChange} />
        <div>
          <RampDeviceTest light={light} schedule={schedule} />
          {light.dli && (
            <>
              <div className="spacer" />
              <ParDliEstimator light={light} dli={light.dli} schedule={schedule} />
            </>
          )}
        </div>
      </section>

      <section className="section">
        <YamlPanel
          yaml={generateRampYaml(schedule, light)}
          prefix={light.prefix}
          state={schedule}
          blockers={rampProblems(light, schedule)}
        />
      </section>
    </>
  )
}
