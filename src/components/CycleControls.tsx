import type { ScheduleState, SiestaLight } from '../types'
import { minutesToHHMM, hhmmToMinutes } from '../utils/generateBlocks'
import { modeOf, leadOf, tailOf, switchMode, solidProblems } from '../utils/solid'
import styles from './CycleControls.module.css'

interface Props {
  light: SiestaLight
  schedule: ScheduleState
  onChange: (s: ScheduleState) => void
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.stepper}>
        <button onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span className={styles.stepperValue}>{value}{unit ? ` ${unit}` : ''}</span>
        <button onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  )
}

function TimePicker({
  label,
  minuteOfDay,
  onChange,
}: {
  label: string
  minuteOfDay: number
  onChange: (m: number) => void
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input
        type="time"
        className={styles.timePicker}
        value={minutesToHHMM(minuteOfDay)}
        onChange={e => onChange(hhmmToMinutes(e.target.value))}
      />
    </div>
  )
}

export default function CycleControls({ light, schedule, onChange }: Props) {
  const { cycle, sunrise, sunset } = schedule
  const solid    = modeOf(schedule) === 'solid'
  const problems = solidProblems(schedule)

  const updateCycle = (patch: Partial<typeof cycle>) =>
    onChange({ ...schedule, cycle: { ...cycle, ...patch } })

  const updateSunrise = (patch: Partial<typeof sunrise>) =>
    onChange({ ...schedule, sunrise: { ...sunrise, ...patch } })

  const updateSunset = (patch: Partial<typeof sunset>) =>
    onChange({ ...schedule, sunset: { ...sunset, ...patch } })

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>{solid ? 'Solid Day' : 'Cycle Pattern'}</h3>

      {light.solidDefaults && (
        <div className={styles.modeToggle} role="radiogroup" aria-label="Schedule mode">
          {(['siesta', 'solid'] as const).map(m => (
            <button key={m} role="radio" aria-checked={modeOf(schedule) === m}
              className={modeOf(schedule) === m ? styles.modeActive : ''}
              onClick={() => modeOf(schedule) !== m && onChange(switchMode(schedule, m, light))}>
              {m === 'siesta' ? 'Siesta' : 'Solid'}
            </button>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <div className={styles.warning} role="alert">
          <strong>Cannot deploy:</strong>
          <ul>{problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Timing</div>
        <TimePicker label={solid ? 'Core Start' : 'Cycle Start'} minuteOfDay={cycle.cycleStart} onChange={v => updateCycle({ cycleStart: v })} />
        <TimePicker label={solid ? 'Core End' : 'Cycle End'} minuteOfDay={cycle.cycleEnd} onChange={v => updateCycle({ cycleEnd: v })} />
      </div>

      {solid ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Spotlight</div>
          <Stepper label="Before Sunrise" value={leadOf(schedule)} min={0} max={120} step={5} unit="min" onChange={v => onChange({ ...schedule, spotlightLeadMinutes: v })} />
          <Stepper label="After Sunset" value={tailOf(schedule)} min={0} max={120} step={5} unit="min" onChange={v => onChange({ ...schedule, spotlightTailMinutes: v })} />
        </div>
      ) : (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Durations</div>
          <Stepper label="WRGB On" value={cycle.wrgbDuration} min={5} max={120} step={5} unit="min" onChange={v => updateCycle({ wrgbDuration: v })} />
          <Stepper label="Spotlight On" value={cycle.spotlightDuration} min={5} max={120} step={5} unit="min" onChange={v => updateCycle({ spotlightDuration: v })} />
          <Stepper label="Overlap" value={cycle.overlapMinutes} min={0} max={10} step={1} unit="min" onChange={v => updateCycle({ overlapMinutes: v })} />
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Sunrise Ramp</div>
        <TimePicker label="Start" minuteOfDay={sunrise.startMinute} onChange={v => updateSunrise({ startMinute: v })} />
        <Stepper label="Duration" value={sunrise.durationMinutes} min={1} max={60} step={1} unit="min" onChange={v => updateSunrise({ durationMinutes: v })} />
        <Stepper label="Steps" value={sunrise.steps} min={1} max={20} step={1} onChange={v => updateSunrise({ steps: v })} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Sunset Ramp</div>
        <TimePicker label="Start" minuteOfDay={sunset.startMinute} onChange={v => updateSunset({ startMinute: v })} />
        <Stepper label="Duration" value={sunset.durationMinutes} min={1} max={60} step={1} unit="min" onChange={v => updateSunset({ durationMinutes: v })} />
        <Stepper label="Steps" value={sunset.steps} min={1} max={20} step={1} onChange={v => updateSunset({ steps: v })} />
      </div>
    </div>
  )
}
