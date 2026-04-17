import { useState } from 'react'
import type { ScheduleState, NanoScheduleState } from './types'
import Timeline from './components/Timeline'
import CycleControls from './components/CycleControls'
import ChannelEditor from './components/ChannelEditor'
import PhotoperiodDisplay from './components/PhotoperiodDisplay'
import ParDliEstimator from './components/ParDliEstimator'
import YamlPanel from './components/YamlPanel'
import DeviceTest from './components/DeviceTest'
import NanoEditor from './components/NanoEditor'
import NanoDeviceTest from './components/NanoDeviceTest'
import { loadDefaults } from './components/ChannelEditor'
import { generateYaml, generateNanoYaml } from './utils/generateYaml'
import './App.css'

const DEFAULT_SCHEDULE: ScheduleState = {
  sunrise: { startMinute: 345, durationMinutes: 15, steps: 3 },
  sunset:  { startMinute: 1020, durationMinutes: 15, steps: 3 },
  cycle: {
    wrgbDuration: 40, spotlightDuration: 20, overlapMinutes: 2,
    cycleStart: 360, cycleEnd: 1020,
  },
  wrgbChannels:        { r: 40, g: 40, b: 40, w: 50 },
  spotlightBrightness: 30,
  ppfdWrgb:            120,
  ppfdSpotlight:       80,
}

const DEFAULT_NANO: NanoScheduleState = {
  rampUpStart:  420,   // 07:00
  peakStart:    540,   // 09:00
  peakEnd:      1080,  // 18:00
  rampDownEnd:  1200,  // 20:00
  peakRgbw:     { r: 40, g: 40, b: 45, w: 55 },
  stepMinutes:  5,
}

function loadNanoDefaults(): NanoScheduleState | null {
  try {
    const raw = localStorage.getItem('aqualight_nano')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveNanoDefaults(s: NanoScheduleState) {
  localStorage.setItem('aqualight_nano', JSON.stringify(s))
}

type Device = 'biotope' | 'nano'

export default function App() {
  const [device, setDevice]     = useState<Device>('biotope')
  const [schedule, setSchedule] = useState<ScheduleState>(() => {
    const saved = loadDefaults()
    return saved ? { ...DEFAULT_SCHEDULE, ...saved } : DEFAULT_SCHEDULE
  })
  const [nano, setNano] = useState<NanoScheduleState>(() => loadNanoDefaults() ?? DEFAULT_NANO)

  function handleNanoChange(s: NanoScheduleState) {
    setNano(s)
    saveNanoDefaults(s)
  }

  const bioYaml  = generateYaml(schedule)
  const nanoYaml = generateNanoYaml(nano)

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
            <button
              className={`device-tab ${device === 'biotope' ? 'device-tab--active' : ''}`}
              onClick={() => setDevice('biotope')}
            >
              100P Biotope
            </button>
            <button
              className={`device-tab ${device === 'nano' ? 'device-tab--active' : ''}`}
              onClick={() => setDevice('nano')}
            >
              WRGB II Pro <span className="device-tab-sub">UNS 45U</span>
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {device === 'biotope' ? (
          <>
            <section className="section timeline-section">
              <Timeline schedule={schedule} onChange={setSchedule} />
            </section>

            <section className="section two-col">
              <div className="col-left">
                <CycleControls schedule={schedule} onChange={setSchedule} />
                <div className="spacer" />
                <ChannelEditor schedule={schedule} onChange={setSchedule} />
              </div>
              <div className="col-right">
                <PhotoperiodDisplay schedule={schedule} />
                <div className="spacer" />
                <ParDliEstimator schedule={schedule} onChange={setSchedule} />
              </div>
            </section>

            <section className="section two-col" style={{ alignItems: 'start' }}>
              <YamlPanel yaml={bioYaml} />
              <DeviceTest schedule={schedule} />
            </section>
          </>
        ) : (
          <>
            <section className="section two-col" style={{ alignItems: 'start' }}>
              <NanoEditor schedule={nano} onChange={handleNanoChange} />
              <NanoDeviceTest schedule={nano} />
            </section>

            <section className="section">
              <YamlPanel yaml={nanoYaml} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
