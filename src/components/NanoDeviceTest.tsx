import { useState } from 'react'
import type { NanoScheduleState, RampLight, LightConfig } from '../types'
import { sendRampTest } from '../testLight'
import s from './NanoDeviceTest.module.css'

interface Props {
  light: RampLight
  schedule: NanoScheduleState
}

type Status = 'idle' | 'busy' | 'ok' | 'error'

const FLASH_MS = 3000

function transportLabel(cfg: LightConfig): string {
  switch (cfg.kind) {
    case 'mqtt':           return `MQTT · ${cfg.topic}`
    case 'ha_light':       return 'HA API · rgbw'
    case 'light_entities': return 'HA API · per-channel'
  }
}

export default function NanoDeviceTest({ light, schedule }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function send(on: boolean) {
    setStatus('busy')
    setMessage('')
    try {
      const result = await sendRampTest(light, schedule.peakRgbw, on)

      if (result.ok) {
        setStatus('ok')
        setMessage(on ? 'Light on' : 'Light off')
      } else {
        setStatus('error')
        setMessage(result.error ?? 'Unknown error')
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
      <p className={s.hint}>Send live commands to confirm the {light.label} is responding.</p>

      <div className={s.device}>
        <div className={s.deviceHeader}>
          <span className={s.deviceLabel}>{light.label}</span>
          <span className={s.deviceMeta}>
            {transportLabel(light.transport)}
          </span>
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
