import { useEffect, useState } from 'react'
import type { ScheduleState, NanoScheduleState, Light, SiestaLight, RampLight } from './types'
import Timeline from './components/Timeline'
import CycleControls from './components/CycleControls'
import ChannelEditor from './components/ChannelEditor'
import PhotoperiodDisplay from './components/PhotoperiodDisplay'
import ParDliEstimator from './components/ParDliEstimator'
import YamlPanel from './components/YamlPanel'
import DeviceTest from './components/DeviceTest'
import NanoEditor from './components/NanoEditor'
import NanoDeviceTest from './components/NanoDeviceTest'
import Presets from './components/Presets'
import { LIGHTS } from './lights'
import { loadStored, saveStored } from './utils/lightStorage'
import { generateLightYaml } from './utils/generateYaml'
import './App.css'

type HydrateSource = 'local' | 'ha' | 'offline'
type AnyState = ScheduleState | NanoScheduleState

/** Defaults from the registry, overlaid with whatever this browser has saved. */
function initialState(light: Light): AnyState {
  const saved = loadStored(light)
  return { ...light.defaults, ...(saved ?? {}) } as AnyState
}

export default function App() {
  const [activeId, setActiveId] = useState<string>(LIGHTS[0].id)

  const [states, setStates] = useState<Record<string, AnyState>>(() =>
    Object.fromEntries(LIGHTS.map(l => [l.id, initialState(l)])),
  )
  const [sources, setSources] = useState<Record<string, HydrateSource>>(() =>
    Object.fromEntries(LIGHTS.map(l => [l.id, 'local' as HydrateSource])),
  )

  // On mount, hydrate each light from the snapshot HA's automations.yaml carries.
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

      const nextStates: Record<string, AnyState> = {}
      const nextSources: Record<string, HydrateSource> = {}
      LIGHTS.forEach((light, i) => {
        const res = results[i]
        if (res?.exists && res.state) {
          nextStates[light.id]  = { ...light.defaults, ...(res.state as object) } as AnyState
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

  function update(light: Light, next: AnyState, persist = false) {
    setStates(s => ({ ...s, [light.id]: next }))
    if (persist) saveStored(light, next as unknown as Record<string, unknown>)
  }

  function handleLoadPreset(light: Light, loaded: Record<string, unknown>) {
    const next = { ...light.defaults, ...loaded } as AnyState
    update(light, next, light.scheduleKind === 'ramp')
    setSources(s => ({ ...s, [light.id]: 'local' }))
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

        {active.scheduleKind === 'siesta'
          ? <SiestaPanels
              light={active as SiestaLight}
              schedule={states[active.id] as ScheduleState}
              onChange={next => update(active, next)}
            />
          : <RampPanels
              light={active as RampLight}
              schedule={states[active.id] as NanoScheduleState}
              onChange={next => update(active, next, true)}
            />}
      </main>
    </div>
  )
}

function SiestaPanels({ light, schedule, onChange }: {
  light: SiestaLight
  schedule: ScheduleState
  onChange: (s: ScheduleState) => void
}) {
  return (
    <>
      <section className="section timeline-section">
        <Timeline schedule={schedule} onChange={onChange} />
      </section>

      <section className="section two-col">
        <div className="col-left">
          <CycleControls schedule={schedule} onChange={onChange} />
          <div className="spacer" />
          <ChannelEditor light={light} schedule={schedule} onChange={onChange} />
        </div>
        <div className="col-right">
          <PhotoperiodDisplay schedule={schedule} />
          {light.dli && (
            <>
              <div className="spacer" />
              <ParDliEstimator schedule={schedule} onChange={onChange} />
            </>
          )}
        </div>
      </section>

      <section className="section two-col" style={{ alignItems: 'start' }}>
        <YamlPanel
          yaml={generateLightYaml(light, schedule)}
          prefix={light.prefix}
          state={schedule}
        />
        <DeviceTest light={light} schedule={schedule} />
      </section>
    </>
  )
}

function RampPanels({ light, schedule, onChange }: {
  light: RampLight
  schedule: NanoScheduleState
  onChange: (s: NanoScheduleState) => void
}) {
  return (
    <>
      <section className="section two-col" style={{ alignItems: 'start' }}>
        <NanoEditor light={light} schedule={schedule} onChange={onChange} />
        <NanoDeviceTest light={light} schedule={schedule} />
      </section>

      <section className="section">
        <YamlPanel
          yaml={generateLightYaml(light, schedule)}
          prefix={light.prefix}
          state={schedule}
        />
      </section>
    </>
  )
}
