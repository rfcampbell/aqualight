import type { CSSProperties } from 'react'
import type { NanoScheduleState, RgbwChannels } from '../types'
import { minutesToHHMM, hhmmToMinutes } from '../utils/generateBlocks'
import styles from './NanoEditor.module.css'

interface Props {
  schedule: NanoScheduleState
  onChange: (s: NanoScheduleState) => void
}

export default function NanoEditor({ schedule, onChange }: Props) {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw, stepMinutes } = schedule

  function setTime(field: 'rampUpStart' | 'peakStart' | 'peakEnd' | 'rampDownEnd', hhmm: string) {
    if (!hhmm) return
    onChange({ ...schedule, [field]: hhmmToMinutes(hhmm) })
  }

  function setChannel(ch: keyof RgbwChannels, val: number) {
    onChange({ ...schedule, peakRgbw: { ...peakRgbw, [ch]: val } })
  }

  const photoHours = ((rampDownEnd - rampUpStart) / 60).toFixed(1)
  const upSteps    = Math.round((peakStart - rampUpStart) / Math.max(1, stepMinutes))
  const downSteps  = Math.round((rampDownEnd - peakEnd) / Math.max(1, stepMinutes))
  const totalAutos = (upSteps + 1) + (downSteps + 1) - (peakStart === peakEnd ? 1 : 0)

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>WRGB II Pro — Ramp Schedule</h3>
      <p className={styles.hint}>UNS 45U · MQTT: chihiros/nano/light/set</p>

      <RampPreview schedule={schedule} />

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
          Photoperiod <strong>{photoHours} h</strong>
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

function Slider({ label, value, color, onChange }: { label: string; value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div className={styles.sliderRow}>
      <label className={styles.sliderLabel}>{label}</label>
      <input
        type="range" min={0} max={100} value={value}
        className={styles.slider}
        style={{ '--track-color': color } as CSSProperties}
        onChange={e => onChange(parseInt(e.target.value))}
      />
      <span className={styles.sliderVal}>{value}</span>
    </div>
  )
}

function RampPreview({ schedule }: { schedule: NanoScheduleState }) {
  const { rampUpStart, peakStart, peakEnd, rampDownEnd, peakRgbw } = schedule
  const MARGIN = 20
  const xMin   = Math.max(0, rampUpStart - MARGIN)
  const xMax   = Math.min(1440, rampDownEnd + MARGIN)
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
