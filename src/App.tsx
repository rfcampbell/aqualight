import { useState } from 'react'
import type { ScheduleState } from './types'
import Timeline from './components/Timeline'
import CycleControls from './components/CycleControls'
import ChannelEditor from './components/ChannelEditor'
import PhotoperiodDisplay from './components/PhotoperiodDisplay'
import ParDliEstimator from './components/ParDliEstimator'
import YamlPanel from './components/YamlPanel'
import './App.css'

// Default schedule per spec:
// 5:45 AM sunrise ramp (15 min, 3 steps)
// 6:00–17:00 cycling: 40 min WRGB / 20 min spotlight, 2-min overlaps
// 17:00 sunset ramp (15 min, 3 steps)
const DEFAULT_SCHEDULE: ScheduleState = {
  sunrise: {
    startMinute: 345,    // 5:45
    durationMinutes: 15,
    steps: 3,
  },
  sunset: {
    startMinute: 1020,   // 17:00
    durationMinutes: 15,
    steps: 3,
  },
  cycle: {
    wrgbDuration: 40,
    spotlightDuration: 20,
    overlapMinutes: 2,
    cycleStart: 360,     // 6:00
    cycleEnd: 1020,      // 17:00
  },
  wrgbChannels: {
    r: 30,
    g: 60,
    b: 85,
    w: 40,
  },
  spotlightBrightness: 70,
  ppfdWrgb: 120,
  ppfdSpotlight: 80,
}

export default function App() {
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE)

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <span className="app-logo-icon">◉</span>
            <h1 className="app-title">AquaLight</h1>
          </div>
          <div className="app-subtitle">Chihiros WRGB &amp; Spotlight Schedule Editor</div>
        </div>
      </header>

      <main className="app-main">
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

        <section className="section">
          <YamlPanel schedule={schedule} />
        </section>
      </main>
    </div>
  )
}
