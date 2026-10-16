import { useEffect, useRef, useState } from 'react'
import type { RampScheduleState, Light, LightConfig } from '../types'
import { sendRampTest, callTestLight } from '../testLight'
import { createLiveSender, type LivePhase } from '../liveSender'
import s from './RampDeviceTest.module.css'

interface Props {
  light: Light
  schedule: RampScheduleState
}

type Status = 'idle' | 'busy' | 'ok' | 'error'
type Rgbw = RampScheduleState['peakRgbw']

const FLASH_MS = 3000
// Wait for a slider to settle before commanding the lamp. Chihiros lamps sit
// behind Bluetooth, so streaming every drag event would queue up and lag.
const LIVE_DELAY_MS = 300

function transportLabel(cfg: LightConfig): string {
  switch (cfg.kind) {
    case 'mqtt':           return `MQTT · ${cfg.topic}`
    case 'ha_light':       return 'HA API · rgbw'
    case 'light_entities': return 'HA API · per-channel'
  }
}

function rgbwColor({ r, g, b, w }: Rgbw) {
  const mix = (c: number) => Math.min(255, Math.round(c * 2.55 + w * 1.8))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

const sameRgbw = (a: Rgbw, b: Rgbw) => a.r === b.r && a.g === b.g && a.b === b.b && a.w === b.w

const PHASE_TEXT: Record<LivePhase, string> = {
  pending: `waiting ${LIVE_DELAY_MS} ms for the slider to settle`,
  sending: 'sending to lamp…',
  applied: 'lamp matches sliders',
  error:   'send failed',
}

export default function RampDeviceTest({ light, schedule }: Props) {
  const [status, setStatus]   = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [live, setLive]       = useState(false)
  const [phase, setPhase]     = useState<LivePhase>('applied')
  const [phaseErr, setPhaseErr] = useState('')
  const [pushSeq, setPushSeq] = useState(0)
  // Last colour the lamp confirmed: undefined = not commanded from here, null = off.
  const [lamp, setLamp]       = useState<Rgbw | null | undefined>(undefined)
  const sender = useRef<ReturnType<typeof createLiveSender<Rgbw>> | null>(null)

  const { r, g, b, w } = schedule.peakRgbw

  // While live, every slider change goes through the debounced sender.
  useEffect(() => { sender.current?.push({ r, g, b, w }) }, [r, g, b, w])
  useEffect(() => () => { sender.current?.stop() }, [])

  async function stopLive() {
    const cur = sender.current
    sender.current = null
    setLive(false)
    await cur?.stop()   // let a send already on the wire land before anything else goes
  }

  function startLive(initial: Rgbw) {
    sender.current = createLiveSender<Rgbw>({
      delayMs: LIVE_DELAY_MS,
      initial,
      equal: sameRgbw,
      send: async (next, prev) => {
        const res = await sendRampTest(light, next, true, prev)
        if (res.ok) setLamp(next)
        return res
      },
      onPhase: (p, err) => { setPhase(p); setPhaseErr(err ?? '') },
      onPush:  () => setPushSeq(n => n + 1),
    })
    setPhase('applied')
    setLive(true)
  }

  async function send(on: boolean, withLive = on) {
    setStatus('busy')
    setMessage('')
    try {
      await stopLive()
      const rgbw   = { r, g, b, w }
      const result = await sendRampTest(light, rgbw, on)
      if (result.ok) {
        setLamp(on ? rgbw : null)
        if (withLive) startLive(rgbw)
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
    send(true, false)
    setTimeout(() => send(false), FLASH_MS)
  }

  const fillStyle = phase === 'pending' ? { animationDuration: `${LIVE_DELAY_MS}ms` } : undefined

  return (
    <div className={s.panel}>
      <h3 className={s.heading}>Device Test</h3>
      <p className={s.hint}>
        Send live commands to confirm the {light.label} is responding. After On, the lamp
        follows the sliders until Off.
      </p>

      <div className={s.device}>
        <div className={s.deviceHeader}>
          <span className={s.deviceLabel}>{light.label}</span>
          <span className={s.deviceMeta}>
            {transportLabel(light.transport)}
          </span>
        </div>

        <div className={s.swatches}>
          <div className={s.swatch}>
            <div className={s.swatchColor} style={{ background: rgbwColor(schedule.peakRgbw) }} />
            <span className={s.swatchLabel}>sliders</span>
          </div>
          <div className={s.swatch}>
            <div className={`${s.swatchColor} ${lamp ? '' : s.swatchEmpty}`}
              style={lamp ? { background: rgbwColor(lamp) } : undefined} />
            <span className={s.swatchLabel}>
              lamp{lamp === null ? ' · off' : lamp === undefined ? ' · not commanded' : ''}
            </span>
          </div>
        </div>

        {live ? (
          <div className={s.live}>
            <div className={s.liveHead}>
              <span className={s.liveDot} /> LIVE
              <span className={phase === 'error' ? s.liveTextError : s.liveText}>
                {phase === 'error' ? `✗ ${phaseErr || PHASE_TEXT.error}` : PHASE_TEXT[phase]}
              </span>
            </div>
            <div className={s.trackRow}>
              <div className={s.track}>
                <div key={pushSeq} className={`${s.fill} ${s[`fill_${phase}`]}`} style={fillStyle} />
              </div>
              <span className={s.trackLabel}>{LIVE_DELAY_MS} ms</span>
            </div>
          </div>
        ) : (
          <div className={s.liveOff}>Live preview off · press On to start</div>
        )}

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

      {light.spotlight && (
        <SpotlightTest entityId={light.spotlight.entityId} brightness={schedule.spotlightBrightness ?? 100} />
      )}
    </div>
  )
}

function SpotlightTest({ entityId, brightness }: { entityId: string; brightness: number }) {
  const [status, setStatus]   = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function send(on: boolean) {
    setStatus('busy')
    try {
      const res = await callTestLight(entityId, on ? 'ON' : 'OFF', on ? brightness : undefined)
      setStatus(res.ok ? 'ok' : 'error')
      setMessage(res.ok ? (on ? `Spotlight on at ${brightness}%` : 'Spotlight off') : res.error ?? 'Unknown error')
    } catch (e: unknown) {
      setStatus('error')
      setMessage(String(e))
    }
  }

  function flash() {
    send(true)
    setTimeout(() => send(false), FLASH_MS)
  }

  return (
    <div className={s.device}>
      <div className={s.deviceHeader}>
        <span className={s.deviceLabel}>Spotlight</span>
        <span className={s.deviceMeta}>HA API · {brightness}%</span>
      </div>
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
  )
}
