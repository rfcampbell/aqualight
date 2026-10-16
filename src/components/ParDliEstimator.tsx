import type { Light, DliParams, RampScheduleState } from '../types'
import { dliMinutes } from '../utils/ramp'
import styles from './ParDliEstimator.module.css'

interface Props {
  light: Light
  dli: DliParams
  schedule: RampScheduleState
}

function dliQuality(dli: number): { label: string; className: string } {
  if (dli < 10) return { label: 'Low', className: styles.qualityLow }
  if (dli <= 30) return { label: 'Medium', className: styles.qualityMedium }
  return { label: 'High', className: styles.qualityHigh }
}

/** DLI from the registry's PPFD, with each ramp step counted at its own level. */
export default function ParDliEstimator({ light, dli, schedule }: Props) {
  const { ppfdWrgb, ppfdSpotlight } = dli
  const { wrgbMinutes, spotlightMinutes } = dliMinutes(light, schedule)

  const dliWrgb = (ppfdWrgb * wrgbMinutes * 60) / 1_000_000
  const dliSpotlight = (ppfdSpotlight * spotlightMinutes * 60) / 1_000_000
  const dliTotal = dliWrgb + dliSpotlight

  const quality = dliQuality(dliTotal)

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>PAR / DLI Estimator</h3>

      <div className={styles.inputs}>
        <div className={styles.field}>
          <span className={styles.label}>WRGB PPFD at peak: <strong>{ppfdWrgb}</strong> µmol/m²/s</span>
        </div>
        {light.spotlight && (
          <div className={styles.field}>
            <span className={styles.label}>Spotlight PPFD: <strong>{ppfdSpotlight}</strong> µmol/m²/s</span>
          </div>
        )}
        {dli.todo && <div className={styles.todo}>⚠ {dli.todo}</div>}
      </div>

      <div className={styles.results}>
        <div className={styles.result}>
          <span className={styles.resultLabel}>WRGB DLI</span>
          <span className={styles.resultVal} style={{ color: '#1a8a6e' }}>{dliWrgb.toFixed(2)}</span>
          <span className={styles.resultUnit}>mol/m²/day</span>
        </div>
        {light.spotlight && (
          <div className={styles.result}>
            <span className={styles.resultLabel}>Spotlight DLI</span>
            <span className={styles.resultVal} style={{ color: '#e8a020' }}>{dliSpotlight.toFixed(2)}</span>
            <span className={styles.resultUnit}>mol/m²/day</span>
          </div>
        )}
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
