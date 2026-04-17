import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduleState } from '../types'
import { minutesToHHMM } from '../utils/generateBlocks'
import styles from './Timeline.module.css'

interface Props {
  schedule: ScheduleState
  onChange: (s: ScheduleState) => void
}

const VIEW_H = 100
const MARGIN = 20  // minutes of "off" buffer to show on each side

// ── Arch generation ────────────────────────────────────────────────────────
// Each independent on-block becomes one sine arch.
// Spotlight arches are shifted back by overlapMinutes so the tails visually
// overlap with the end of the preceding WRGB arch.
function getArches(s: ScheduleState): { wrgb: [number, number][]; spot: [number, number][] } {
  const { sunrise, sunset, cycle } = s
  const { wrgbDuration, spotlightDuration, overlapMinutes, cycleStart, cycleEnd } = cycle
  const wrgb: [number, number][] = []
  const spot: [number, number][] = []

  // Sunrise ramp arch
  wrgb.push([sunrise.startMinute, sunrise.startMinute + sunrise.durationMinutes])

  let t = cycleStart
  let isWrgb = true
  let firstBlock = true

  while (t < cycleEnd) {
    if (isWrgb) {
      const end = Math.min(t + wrgbDuration, cycleEnd)
      // From 2nd WRGB block on, start early to overlap spotlight tail
      const start = firstBlock ? t : Math.max(cycleStart, t - overlapMinutes)
      wrgb.push([start, end])
      firstBlock = false
      t = end
    } else {
      const end = Math.min(t + spotlightDuration, cycleEnd)
      // Spotlight starts early, overlapping with WRGB tail
      const start = Math.max(cycleStart, t - overlapMinutes)
      spot.push([start, end])
      t = end
    }
    isWrgb = !isWrgb
    if (t >= cycleEnd) break
  }

  // Sunset ramp arch
  wrgb.push([sunset.startMinute, sunset.startMinute + sunset.durationMinutes])

  return { wrgb, spot }
}

// ── SVG path builders ───────────────────────────────────────────────────────
// Cubic bezier approximation of sin(t·π) — smooth arch from (x0, bottom) to (x1, bottom).
// Control points at 37% from each end at y=0 give a convincing sine shape.
function archFill(x0: number, x1: number, yPeak: number = 0): string {
  const s = x1 - x0
  return `M ${x0},${VIEW_H} C ${x0 + s * 0.37},${yPeak} ${x1 - s * 0.37},${yPeak} ${x1},${VIEW_H} Z`
}

function archStroke(x0: number, x1: number, yPeak: number = 0): string {
  const s = x1 - x0
  return `M ${x0},${VIEW_H} C ${x0 + s * 0.37},${yPeak} ${x1 - s * 0.37},${yPeak} ${x1},${VIEW_H}`
}

// ── Tooltip value at a minute ───────────────────────────────────────────────
// Returns the sine amplitude (0–1) for each light at the given minute.
function getActiveAt(arches: ReturnType<typeof getArches>, minute: number) {
  const sine = (arcs: [number, number][]) => {
    for (const [x0, x1] of arcs) {
      if (minute >= x0 && minute <= x1) {
        return Math.sin(((minute - x0) / (x1 - x0)) * Math.PI)
      }
    }
    return 0
  }
  return { wrgb: sine(arches.wrgb), spotlight: sine(arches.spot) }
}

// ── Color helpers ───────────────────────────────────────────────────────────
function wrgbTopColor(ch: ScheduleState['wrgbChannels']): string {
  const mix = (c: number) => Math.min(255, Math.round(c * 2.55 + ch.w * 1.8))
  return `rgb(${mix(ch.r)}, ${mix(ch.g)}, ${mix(ch.b)})`
}

interface Tooltip { minute: number; pct: number; wrgb: number; spotlight: number }

// ── Component ───────────────────────────────────────────────────────────────
export default function Timeline({ schedule, onChange }: Props) {
  const { sunrise, sunset, cycle, wrgbChannels } = schedule
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [dragging, setDragging] = useState<'sunrise' | 'sunset' | null>(null)
  const [currentMinute, setCurrentMinute] = useState(() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  })

  // Trimmed view window — show only active period + small margin
  const xMin = Math.max(0, sunrise.startMinute - MARGIN)
  const xMax = Math.min(1440, sunset.startMinute + sunset.durationMinutes + MARGIN)
  const xRange = xMax - xMin

  // Convert a minute to a CSS left % within the trimmed window
  const toPct = (m: number) => `${((m - xMin) / xRange) * 100}%`

  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date()
      setCurrentMinute(now.getHours() * 60 + now.getMinutes())
    }, 60000)
    return () => clearInterval(iv)
  }, [])

  const minuteFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!wrapRef.current) return 0
    const rect = wrapRef.current.getBoundingClientRect()
    const raw = xMin + ((e.clientX - rect.left) / rect.width) * xRange
    return Math.round(Math.max(xMin, Math.min(xMax, raw)))
  }, [xMin, xRange, xMax])

  // Drag — attach globally so mouse can leave the element
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const min = minuteFromEvent(e)
      if (dragging === 'sunrise') {
        const clamped = Math.max(0, Math.min(min, cycle.cycleStart - sunrise.durationMinutes))
        onChange({ ...schedule, sunrise: { ...sunrise, startMinute: clamped } })
      } else {
        const clamped = Math.max(cycle.cycleStart + 60, Math.min(1380, min))
        onChange({ ...schedule, cycle: { ...cycle, cycleEnd: clamped }, sunset: { ...sunset, startMinute: clamped } })
      }
    }
    const onUp = () => setDragging(null)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, schedule, onChange, minuteFromEvent, cycle, sunrise, sunset])

  const handleMouseMove = (e: React.MouseEvent) => {
    const min = minuteFromEvent(e)
    const rect = wrapRef.current!.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    const vals = getActiveAt(arches, min)
    setTooltip({ minute: min, pct, ...vals })
  }

  const arches = getArches(schedule)
  const topColor = wrgbTopColor(wrgbChannels)

  // Overlap zones: time intervals where a WRGB arch and a spotlight arch intersect
  const overlapZones: [number, number][] = []
  for (const [wx0, wx1] of arches.wrgb) {
    for (const [sx0, sx1] of arches.spot) {
      const lo = Math.max(wx0, sx0), hi = Math.min(wx1, sx1)
      if (hi > lo) overlapZones.push([lo, hi])
    }
  }

  // Hour labels — only those that fall within the trimmed window
  const hourLabels: number[] = []
  for (let h = 0; h <= 24; h++) {
    const m = h * 60
    if (m > xMin && m < xMax) hourLabels.push(m)
  }

  const flipTooltip = tooltip && tooltip.pct > 72

  return (
    <div className={styles.timeline}>
      <div className={styles.legend}>
        <span className={styles.legendWrgb}>WRGB</span>
        <span className={styles.legendSpot}>Spotlight</span>
        <span className={styles.legendOverlap}>Overlap</span>
      </div>

      <div
        className={styles.svgWrap}
        ref={wrapRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <svg
          className={styles.svg}
          viewBox={`${xMin} 0 ${xRange} ${VIEW_H}`}
          preserveAspectRatio="none"
          overflow="hidden"
        >
          <defs>
            <linearGradient id="wrgbGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={topColor}  stopOpacity="0.82" />
              <stop offset="100%" stopColor="#040c12"   stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="spotGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#f0a030" stopOpacity="0.62" />
              <stop offset="100%" stopColor="#160900" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Hour gridlines */}
          {hourLabels.map(m => (
            <line key={m} x1={m} y1="0" x2={m} y2={VIEW_H}
              stroke="#1a2030" strokeWidth="1" />
          ))}

          {/* Spotlight arches — behind WRGB */}
          {arches.spot.map(([x0, x1], i) => (
            <g key={`spot-${i}`}>
              <path d={archFill(x0, x1, 4)}   fill="url(#spotGrad)" />
              <path d={archStroke(x0, x1, 4)} fill="none" stroke="#f0b840" strokeWidth="1.5" />
            </g>
          ))}

          {/* WRGB arches — in front */}
          {arches.wrgb.map(([x0, x1], i) => (
            <g key={`wrgb-${i}`}>
              <path d={archFill(x0, x1)}   fill="url(#wrgbGrad)" />
              <path d={archStroke(x0, x1)} fill="none" stroke={topColor} strokeWidth="1.5" opacity="0.9" />
            </g>
          ))}

          {/* Overlap zone — gold tint rect where arches intersect */}
          {overlapZones.map(([x0, x1], i) => (
            <rect key={`ov-${i}`}
              x={x0} y={2} width={x1 - x0} height={VIEW_H - 4}
              fill="rgba(255,180,40,0.20)"
              stroke="rgba(255,215,80,0.7)"
              strokeWidth="0.5"
            />
          ))}

          {/* Now-line: soft purple glow + thin core */}
          <line x1={currentMinute} y1="0" x2={currentMinute} y2={VIEW_H}
            stroke="#7c3aed" strokeWidth="3" opacity="0.3"
            className={styles.nowLine} />
          <line x1={currentMinute} y1="0" x2={currentMinute} y2={VIEW_H}
            stroke="#a855f7" strokeWidth="0.8"
            className={styles.nowLine} />
        </svg>

        {/* HTML overlay: icons, drag handles, tooltip */}
        <div className={styles.overlay}>
          <span className={styles.sunIcon} style={{ left: toPct(sunrise.startMinute) }}
            title={`Sunrise: ${minutesToHHMM(sunrise.startMinute)}`}>☀</span>
          <span className={styles.moonIcon} style={{ left: toPct(sunset.startMinute + sunset.durationMinutes) }}
            title={`Lights off: ${minutesToHHMM(sunset.startMinute + sunset.durationMinutes)}`}>☾</span>

          <div className={styles.dragHandle} style={{ left: toPct(sunrise.startMinute) }}
            title="Drag to adjust sunrise time"
            onMouseDown={e => { e.preventDefault(); setDragging('sunrise') }} />
          <div className={styles.dragHandle} style={{ left: toPct(sunset.startMinute) }}
            title="Drag to adjust sunset time"
            onMouseDown={e => { e.preventDefault(); setDragging('sunset') }} />

          {tooltip && (
            <div className={styles.tooltip} style={{
              left: `${tooltip.pct}%`,
              transform: flipTooltip ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}>
              <div className={styles.tooltipTime}>{minutesToHHMM(tooltip.minute)}</div>
              {tooltip.wrgb > 0.01 && (
                <div className={styles.tooltipRow} style={{ color: '#4dd4f8' }}>
                  WRGB {Math.round(tooltip.wrgb * 100)}%
                </div>
              )}
              {tooltip.spotlight > 0.01 && (
                <div className={styles.tooltipRow} style={{ color: '#f0b840' }}>
                  Spotlight {Math.round(tooltip.spotlight * 100)}%
                </div>
              )}
              {tooltip.wrgb < 0.01 && tooltip.spotlight < 0.01 && (
                <div className={styles.tooltipRow} style={{ color: '#4a5568' }}>Off</div>
              )}
            </div>
          )}
        </div>

        <div className={styles.vignette} />
      </div>

      <div className={styles.hourAxis}>
        {hourLabels.map(m => (
          <div key={m} className={styles.hourTick} style={{ left: toPct(m) }}>
            <span>{minutesToHHMM(m)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
