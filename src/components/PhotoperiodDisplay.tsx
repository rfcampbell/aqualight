import type { ScheduleState } from '../types'
import { calcPhotoperiodMinutes } from '../utils/generateBlocks'
import styles from './PhotoperiodDisplay.module.css'

interface Props {
  schedule: ScheduleState
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export default function PhotoperiodDisplay({ schedule }: Props) {
  const { wrgbMinutes, spotlightMinutes } = calcPhotoperiodMinutes(schedule)
  const wrgbHours = wrgbMinutes / 60
  const slHours = spotlightMinutes / 60

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Photoperiod</h3>
      <div className={styles.stat}>
        <div className={styles.statLabel}>WRGB On</div>
        <div className={styles.statValue} style={{ color: '#1a8a6e' }}>
          {fmtHours(wrgbMinutes)}
        </div>
        <div className={styles.statSub}>{wrgbHours.toFixed(1)} hours/day</div>
      </div>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Spotlight On</div>
        <div className={styles.statValue} style={{ color: '#e8a020' }}>
          {fmtHours(spotlightMinutes)}
        </div>
        <div className={styles.statSub}>{slHours.toFixed(1)} hours/day</div>
      </div>
    </div>
  )
}
