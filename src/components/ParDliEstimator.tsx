import type { ScheduleState } from '../types'
import { calcPhotoperiodMinutes } from '../utils/generateBlocks'
import styles from './ParDliEstimator.module.css'

interface Props {
  schedule: ScheduleState
  onChange: (s: ScheduleState) => void
}

function dliQuality(dli: number): { label: string; className: string } {
  if (dli < 10) return { label: 'Low', className: styles.qualityLow }
  if (dli <= 30) return { label: 'Medium', className: styles.qualityMedium }
  return { label: 'High', className: styles.qualityHigh }
}

export default function ParDliEstimator({ schedule, onChange }: Props) {
  const { ppfdWrgb, ppfdSpotlight } = schedule
  const { wrgbMinutes, spotlightMinutes } = calcPhotoperiodMinutes(schedule)

  const dliWrgb = (ppfdWrgb * wrgbMinutes * 60) / 1_000_000
  const dliSpotlight = (ppfdSpotlight * spotlightMinutes * 60) / 1_000_000
  const dliTotal = dliWrgb + dliSpotlight

  const quality = dliQuality(dliTotal)

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>PAR / DLI Estimator</h3>

      <div className={styles.inputs}>
        <div className={styles.field}>
          <label className={styles.label}>WRGB PPFD (µmol/m²/s)</label>
          <input
            type="number"
            min={0}
            max={2000}
            className={styles.numberInput}
            value={ppfdWrgb}
            onChange={e => onChange({ ...schedule, ppfdWrgb: Number(e.target.value) })}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Spotlight PPFD (µmol/m²/s)</label>
          <input
            type="number"
            min={0}
            max={2000}
            className={styles.numberInput}
            value={ppfdSpotlight}
            onChange={e => onChange({ ...schedule, ppfdSpotlight: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className={styles.results}>
        <div className={styles.result}>
          <span className={styles.resultLabel}>WRGB DLI</span>
          <span className={styles.resultVal} style={{ color: '#1a8a6e' }}>{dliWrgb.toFixed(2)}</span>
          <span className={styles.resultUnit}>mol/m²/day</span>
        </div>
        <div className={styles.result}>
          <span className={styles.resultLabel}>Spotlight DLI</span>
          <span className={styles.resultVal} style={{ color: '#e8a020' }}>{dliSpotlight.toFixed(2)}</span>
          <span className={styles.resultUnit}>mol/m²/day</span>
        </div>
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Combined DLI</span>
          <span className={styles.totalVal}>{dliTotal.toFixed(2)}</span>
          <span className={styles.resultUnit}>mol/m²/day</span>
          <span className={`${styles.qualityBadge} ${quality.className}`}>{quality.label}</span>
        </div>
        <div className={styles.legend}>
          <span className={styles.qualityLow}>Low</span> &lt;10 ·{' '}
          <span className={styles.qualityMedium}>Medium</span> 10–30 ·{' '}
          <span className={styles.qualityHigh}>High</span> &gt;30 mol/m²/day
        </div>
      </div>
    </div>
  )
}
