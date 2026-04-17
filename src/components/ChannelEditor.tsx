import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ScheduleState } from '../types'
import styles from './ChannelEditor.module.css'

const LS_KEY = 'aqualight_defaults'

export function saveDefaults(schedule: ScheduleState) {
  localStorage.setItem(LS_KEY, JSON.stringify({
    wrgbChannels: schedule.wrgbChannels,
    spotlightBrightness: schedule.spotlightBrightness,
  }))
}

export function loadDefaults(): Pick<ScheduleState, 'wrgbChannels' | 'spotlightBrightness'> | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

interface Props {
  schedule: ScheduleState
  onChange: (s: ScheduleState) => void
}

function Slider({
  label,
  value,
  color,
  onChange,
}: {
  label: string
  value: number
  color: string
  onChange: (v: number) => void
}) {
  return (
    <div className={styles.sliderRow}>
      <label className={styles.sliderLabel}>{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        className={styles.slider}
        style={{ '--track-color': color } as CSSProperties}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className={styles.sliderValue}>{value}</span>
    </div>
  )
}

export default function ChannelEditor({ schedule, onChange }: Props) {
  const [saved, setSaved] = useState(false)
  const { wrgbChannels, spotlightBrightness } = schedule
  const { r, g, b, w } = wrgbChannels

  function handleSetDefault() {
    saveDefaults(schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const setChannel = (channel: keyof typeof wrgbChannels, val: number) =>
    onChange({ ...schedule, wrgbChannels: { ...wrgbChannels, [channel]: val } })

  // Color swatch: blend white with RGB, scale 0-100 → 0-255
  const s = (v: number) => Math.round(v * 2.55)
  const swatchR = Math.min(255, s(r) + s(w))
  const swatchG = Math.min(255, s(g) + s(w))
  const swatchB = Math.min(255, s(b) + s(w))
  const swatchColor = `rgb(${swatchR}, ${swatchG}, ${swatchB})`

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Channel Editor</h3>

      <div className={styles.rgbSection}>
        <div className={styles.sectionTitle}>WRGB Lamp</div>
        <div className={styles.swatchRow}>
          <div className={styles.swatch} style={{ background: swatchColor }} />
          <span className={styles.swatchLabel}>Color preview</span>
        </div>
        <Slider label="Red" value={r} color="#c0392b" onChange={v => setChannel('r', v)} />
        <Slider label="Green" value={g} color="#27ae60" onChange={v => setChannel('g', v)} />
        <Slider label="Blue" value={b} color="#2980b9" onChange={v => setChannel('b', v)} />
        <Slider label="White" value={w} color="#cccccc" onChange={v => setChannel('w', v)} />
      </div>

      <div className={styles.sliderRow} style={{ marginTop: '1rem' }}>
        <label className={styles.sliderLabel}>Spotlight</label>
        <input
          type="range"
          min={0}
          max={100}
          value={spotlightBrightness}
          className={styles.slider}
          style={{ '--track-color': '#e8a020' } as CSSProperties}
          onChange={e => onChange({ ...schedule, spotlightBrightness: Number(e.target.value) })}
        />
        <span className={styles.sliderValue}>{spotlightBrightness}</span>
      </div>

      <button className={saved ? styles.defaultBtnSaved : styles.defaultBtn} onClick={handleSetDefault}>
        {saved ? '✓ saved as default' : 'set as default'}
      </button>
    </div>
  )
}
