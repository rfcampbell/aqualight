import { useState } from 'react'
import type { ScheduleState } from '../types'
import s from './DeviceTest.module.css'

interface Props {
  schedule: ScheduleState
}

type Status = 'idle' | 'busy' | 'ok' | 'error'

interface DeviceState {
  status: Status
  message: string
}

const FLASH_MS = 3000

export default function DeviceTest({ schedule }: Props) {
  const [wrgb, setWrgb] = useState<DeviceState>({ status: 'idle', message: '' })
  const [spot, setSpot] = useState<DeviceState>({ status: 'idle', message: '' })

  async function sendWrgb(on: boolean) {
    setWrgb({ status: 'busy', message: '' })
    try {
      const body = on
        ? {
            state: 'ON',
            r: schedule.wrgbChannels.r,
            g: schedule.wrgbChannels.g,
            b: schedule.wrgbChannels.b,
            w: schedule.wrgbChannels.w,
          }
        : { state: 'OFF' }

      const res = await fetch('/api/test/wrgb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.ok) {
        setWrgb({ status: 'ok', message: on ? 'Light on' : 'Light off' })
      } else {
        setWrgb({ status: 'error', message: json.error ?? 'Unknown error' })
      }
    } catch (e: unknown) {
      setWrgb({ status: 'error', message: String(e) })
    }
  }

  async function sendSpot(on: boolean) {
    setSpot({ status: 'busy', message: '' })
    try {
      const body = on
        ? { state: 'ON', brightness: schedule.spotlightBrightness }
        : { state: 'OFF' }

      const res = await fetch('/api/test/spotlight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.ok) {
        setSpot({ status: 'ok', message: on ? 'Spotlight on' : 'Spotlight off' })
      } else {
        setSpot({ status: 'error', message: json.error ?? 'Unknown error' })
      }
    } catch (e: unknown) {
      setSpot({ status: 'error', message: String(e) })
    }
  }

  async function flashWrgb() {
    await sendWrgb(true)
    setTimeout(() => sendWrgb(false), FLASH_MS)
  }

  async function flashSpot() {
    await sendSpot(true)
    setTimeout(() => sendSpot(false), FLASH_MS)
  }

  return (
    <div className={s.panel}>
      <h3 className={s.heading}>Device Test</h3>
      <p className={s.hint}>
        Send live commands to confirm devices are responding. Uses current channel/brightness values.
      </p>

      <div className={s.devices}>
        {/* WRGB */}
        <div className={s.device}>
          <div className={s.deviceHeader}>
            <span className={s.deviceLabel}>WRGB Light</span>
            <span className={s.deviceMeta}>MQTT · chihiros</span>
          </div>
          <div className={s.colorPreview} style={{ background: wrgbColor(schedule.wrgbChannels) }} />
          <div className={s.btnRow}>
            <button
              className={`${s.btn} ${s.btnOn}`}
              onClick={() => sendWrgb(true)}
              disabled={wrgb.status === 'busy'}
            >
              On
            </button>
            <button
              className={`${s.btn} ${s.btnOff}`}
              onClick={() => sendWrgb(false)}
              disabled={wrgb.status === 'busy'}
            >
              Off
            </button>
            <button
              className={`${s.btn} ${s.btnFlash}`}
              onClick={flashWrgb}
              disabled={wrgb.status === 'busy'}
              title={`Turn on for ${FLASH_MS / 1000}s then off`}
            >
              Flash
            </button>
          </div>
          <StatusBadge state={wrgb} />
        </div>

        {/* Spotlight */}
        <div className={s.device}>
          <div className={s.deviceHeader}>
            <span className={s.deviceLabel}>Spotlight</span>
            <span className={s.deviceMeta}>HA API · {schedule.spotlightBrightness}%</span>
          </div>
          <div className={s.colorPreview} style={{ background: `rgba(255, 160, 30, ${schedule.spotlightBrightness / 100})` }} />
          <div className={s.btnRow}>
            <button
              className={`${s.btn} ${s.btnOn}`}
              onClick={() => sendSpot(true)}
              disabled={spot.status === 'busy'}
            >
              On
            </button>
            <button
              className={`${s.btn} ${s.btnOff}`}
              onClick={() => sendSpot(false)}
              disabled={spot.status === 'busy'}
            >
              Off
            </button>
            <button
              className={`${s.btn} ${s.btnFlash}`}
              onClick={flashSpot}
              disabled={spot.status === 'busy'}
              title={`Turn on for ${FLASH_MS / 1000}s then off`}
            >
              Flash
            </button>
          </div>
          <StatusBadge state={spot} />
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ state }: { state: DeviceState }) {
  if (state.status === 'idle') return null
  if (state.status === 'busy') return <div className={`${s.status} ${s.statusBusy}`}>sending…</div>
  if (state.status === 'ok') return <div className={`${s.status} ${s.statusOk}`}>✓ {state.message}</div>
  return <div className={`${s.status} ${s.statusError}`}>✗ {state.message}</div>
}

function wrgbColor(ch: { r: number; g: number; b: number; w: number }) {
  const mix = (c: number) => Math.min(255, Math.round(c * 2.55 + ch.w * 1.8))
  return `rgb(${mix(ch.r)}, ${mix(ch.g)}, ${mix(ch.b)})`
}
