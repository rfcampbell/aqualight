import type { CSSProperties } from 'react'
import type { RampScheduleState, RgbwChannels, Light } from '../types'
import { minutesToHHMM, hhmmToMinutes, rampEvents, spotWindows, photoperiodMinutes } from '../utils/ramp'
import styles from './RampEditor.module.css'

interface Props {
  light: Light
  schedule: RampScheduleState
  onChange: (s: RampScheduleState) => void
}

const SPOT_COLOR = '#e8a020'

export default function RampEditor({ light, schedule, onChange }: Props) {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw, stepMinutes } = schedule

  function setTime(field: 'rampUpStart' | 'peakStart' | 'peakEnd' | 'rampDownEnd', hhmm: string) {
    if (!hhmm) return
    onChange({ ...schedule, [field]: hhmmToMinutes(hhmm) })
  }

  function setChannel(ch: keyof RgbwChannels, val: number) {
    onChange({ ...schedule, peakRgbw: { ...peakRgbw, [ch]: val } })
  }

  const { wrgbMinutes, spotlightMinutes } = photoperiodMinutes(light, schedule)
  const windows    = spotWindows(light, schedule)
  const totalAutos = rampEvents(schedule).length + windows.length * 2

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>{light.label} — Ramp Schedule</h3>
      <p className={styles.hint}>
        {[light.sublabel, light.transport.kind === 'mqtt' ? `MQTT: ${light.transport.topic}` : null]
          .filter(Boolean).join(' · ')}
      </p>

      <RampPreview schedule={schedule} windows={windows} />

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Ramp Waypoints</div>
        <div className={styles.timeGrid}>
          <TimeInput label="Ramp Up Start" value={minutesToHHMM(rampUpStart)} onChange={v => setTime('rampUpStart', v)} />
          <TimeInput label="Peak Start"    value={minutesToHHMM(peakStart)}    onChange={v => setTime('peakStart', v)} />
          <TimeInput label="Peak End"      value={minutesToHHMM(peakEnd)}      onChange={v => setTime('peakEnd', v)} />
          <TimeInput label="Ramp Down End" value={minutesToHHMM(rampDownEnd)}  onChange={v => setTime('rampDownEnd', v)} />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Peak RGBW (0–100)</div>
        <div className={styles.sliders}>
          <Slider label="Red"   value={peakRgbw.r} color="#f87171" onChange={v => setChannel('r', v)} />
          <Slider label="Green" value={peakRgbw.g} color="#4ade80" onChange={v => setChannel('g', v)} />
          <Slider label="Blue"  value={peakRgbw.b} color="#60a5fa" onChange={v => setChannel('b', v)} />
          <Slider label="White" value={peakRgbw.w} color="#cbd5e1" onChange={v => setChannel('w', v)} />
        </div>
      </div>

      {light.spotlight && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Spotlight · {light.spotlight.entityId}</div>
          <Slider label="Level" min={1} value={schedule.spotlightBrightness ?? 100} color={SPOT_COLOR}
            onChange={v => onChange({ ...schedule, spotlightBrightness: v })} />
          <div className={styles.spotGrid}>
            <MinutesInput label="Lead (before ramp up)" value={schedule.spotlightLeadMinutes ?? 0}
              onChange={v => onChange({ ...schedule, spotlightLeadMinutes: v })} />
            <MinutesInput label="Tail (after ramp down)" value={schedule.spotlightTailMinutes ?? 0}
              onChange={v => onChange({ ...schedule, spotlightTailMinutes: v })} />
          </div>
          <div className={styles.spotWindows}>
            On {windows.map(([a, b]) => `${minutesToHHMM(a)}–${minutesToHHMM(b)}`).join(' and ')}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <label className={styles.stepRow}>
          <span className={styles.stepLabel}>Step</span>
          <input
            type="number" min={1} max={60} value={stepMinutes}
            className={styles.stepInput}
            onChange={e => onChange({ ...schedule, stepMinutes: Math.max(1, Math.min(60, parseInt(e.target.value) || 5)) })}
          />
          <span className={styles.stepUnit}>min · {totalAutos} automations</span>
        </label>
        <div className={styles.photoperiod}>
          Photoperiod <strong>{(wrgbMinutes / 60).toFixed(1)} h</strong>
          {light.spotlight && <> · spotlight <strong>{(spotlightMinutes / 60).toFixed(1)} h</strong></>}
        </div>
      </div>
    </div>
  )
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.timeInputWrap}>
      <span className={styles.timeLabel}>{label}</span>
      <input type="time" value={value} className={styles.timeInput} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function MinutesInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className={styles.stepRow}>
      <span className={styles.stepLabel}>{label}</span>
      <input
        type="number" min={0} max={240} value={value}
        className={styles.stepInput}
        onChange={e => onChange(Math.max(0, Math.min(240, parseInt(e.target.value) || 0)))}
      />
      <span className={styles.stepUnit}>min</span>
    </label>
  )
}

function Slider({ label, value, color, onChange, min = 0 }: {
  label: string; value: number; color: string; onChange: (v: number) => void; min?: number
}) {
  return (
    <div className={styles.sliderRow}>
      <label className={styles.sliderLabel}>{label}</label>
      <input
        type="range" min={min} max={100} value={value}
        className={styles.slider}
        style={{ '--track-color': color } as CSSProperties}
        onChange={e => onChange(parseInt(e.target.value))}
      />
      <span className={styles.sliderVal}>{value}</span>
    </div>
  )
}

function RampPreview({ schedule, windows }: { schedule: RampScheduleState; windows: [number, number][] }) {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw } = schedule
  const MARGIN = 20
  const xMin   = Math.max(0, Math.min(rampUpStart, ...windows.map(w => w[0])) - MARGIN)
  const xMax   = Math.min(1440, Math.max(rampDownEnd, ...windows.map(w => w[1])) + MARGIN)
  const xRange = Math.max(1, xMax - xMin)
  const W = 400, H = 50

  const tx = (m: number) => ((m - xMin) / xRange) * W

  const mix = (c: number) => Math.min(255, Math.round(c * 2.55 + peakRgbw.w * 1.8))
  const color = `rgb(${mix(peakRgbw.r)}, ${mix(peakRgbw.g)}, ${mix(peakRgbw.b)})`

  const trapFill   = `${tx(xMin)},${H} ${tx(rampUpStart)},${H} ${tx(peakStart)},0 ${tx(peakEnd)},0 ${tx(rampDownEnd)},${H} ${tx(xMax)},${H}`
  const trapStroke = `${tx(rampUpStart)},${H} ${tx(peakStart)},0 ${tx(peakEnd)},0 ${tx(rampDownEnd)},${H}`

  const hourLabels: number[] = []
  for (let h = 0; h <= 24; h++) {
    const m = h * 60
    if (m > xMin && m < xMax) hourLabels.push(m)
  }

  return (
    <div className={styles.preview}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.previewSvg}>
        <defs>
          <linearGradient id="nanoRampGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.72" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {hourLabels.map(m => (
          <line key={m} x1={tx(m)} y1={0} x2={tx(m)} y2={H} stroke="#1a2030" strokeWidth="1" />
        ))}
        {windows.map(([a, b]) => (
          <rect key={a} x={tx(a)} y={H - 8} width={Math.max(0, tx(b) - tx(a))} height={8}
            fill={SPOT_COLOR} opacity="0.55" />
        ))}
        <polygon points={trapFill}   fill="url(#nanoRampGrad)" />
        <polyline points={trapStroke} fill="none" stroke={color} strokeWidth="1.5" opacity="0.9" />
      </svg>
      <div className={styles.previewLabels}>
        {[rampUpStart, peakStart, peakEnd, rampDownEnd].map(m => (
          <span key={m} className={styles.previewTick} style={{ left: `${((m - xMin) / xRange) * 100}%` }}>
            {minutesToHHMM(m)}
          </span>
        ))}
      </div>
    </div>
  )
}
