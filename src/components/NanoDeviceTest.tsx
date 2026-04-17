import { useState } from 'react'
import type { NanoScheduleState } from '../types'
import s from './NanoDeviceTest.module.css'

interface Props {
  schedule: NanoScheduleState
}

type Status = 'idle' | 'busy' | 'ok' | 'error'

const FLASH_MS = 3000

export default function NanoDeviceTest({ schedule }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function send(on: boolean) {
    setStatus('busy')
    setMessage('')
    try {
      const { r, g, b, w } = schedule.peakRgbw
      const body = on ? { state: 'ON', r, g, b, w } : { state: 'OFF' }
      const res  = await fetch('/api/test/nano', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.ok) {
        setStatus('ok')
        setMessage(on ? 'Light on' : 'Light off')
      } else {
        setStatus('error')
        setMessage(json.error ?? 'Unknown error')
      }
    } catch (e: unknown) {
      setStatus('error')
      setMessage(String(e))
    }
  }

  function flash() {
    send(true)
    setTimeout(() => send(false), FLASH_MS)
  }

  const { r, g, b, w } = schedule.peakRgbw
  const mix = (c: number) => Math.min(255, Math.round(c * 2.55 + w * 1.8))
  const previewColor = `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`

  return (
    <div className={s.panel}>
      <h3 className={s.heading}>Device Test</h3>
      <p className={s.hint}>Send live commands to confirm the nano light is responding.</p>

      <div className={s.device}>
        <div className={s.deviceHeader}>
          <span className={s.deviceLabel}>WRGB II Pro</span>
          <span className={s.deviceMeta}>MQTT · chihiros/nano</span>
        </div>
        <div className={s.colorPreview} style={{ background: previewColor }} />
        <div className={s.btnRow}>
          <button className={`${s.btn} ${s.btnOn}`}    onClick={() => send(true)}  disabled={status === 'busy'}>On</button>
          <button className={`${s.btn} ${s.btnOff}`}   onClick={() => send(false)} disabled={status === 'busy'}>Off</button>
          <button className={`${s.btn} ${s.btnFlash}`} onClick={flash}             disabled={status === 'busy'}
            title={`On for ${FLASH_MS / 1000}s then off`}>Flash</button>
        </div>
        {status === 'busy' && <div className={`${s.status} ${s.statusBusy}`}>sending…</div>}
        {status === 'ok'   && <div className={`${s.status} ${s.statusOk}`}>✓ {message}</div>}
        {status === 'error'&& <div className={`${s.status} ${s.statusError}`}>✗ {message}</div>}
      </div>
    </div>
  )
}
