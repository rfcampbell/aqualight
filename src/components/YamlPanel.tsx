import { useState } from 'react'
import type { ScheduleState } from '../types'
import { generateYaml } from '../utils/generateYaml'
import styles from './YamlPanel.module.css'

interface Props {
  schedule: ScheduleState
}

type DeployState = 'idle' | 'deploying' | 'ok' | 'error'

export default function YamlPanel({ schedule }: Props) {
  const [copied, setCopied]         = useState(false)
  const [deploy, setDeploy]         = useState<DeployState>('idle')
  const [deployMsg, setDeployMsg]   = useState('')

  const yaml = generateYaml(schedule)
  const lineCount = yaml.split('\n').length

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yaml)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'automations.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDeploy = async () => {
    setDeploy('deploying')
    setDeployMsg('')
    try {
      const res  = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      })
      const data = await res.json()
      if (data.success) {
        const reloadNote = data.reload.status === 'reloaded'
          ? 'Automations reloaded.'
          : data.reload.reason ?? 'Set HA_TOKEN to auto-reload.'
        setDeployMsg(`Deployed. ${reloadNote}`)
        setDeploy('ok')
      } else {
        setDeployMsg(data.error ?? 'Deploy failed.')
        setDeploy('error')
      }
    } catch {
      setDeployMsg('Cannot reach deploy API — is the backend running?')
      setDeploy('error')
    }
    setTimeout(() => setDeploy('idle'), 6000)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.heading}>YAML Export</h3>
        <div className={styles.meta}>
          {lineCount} lines · {yaml.length} bytes
        </div>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={handleDownload}>
            Download
          </button>
          <button
            className={`${styles.btnSecondary} ${copied ? styles.btnCopied : ''}`}
            onClick={handleCopy}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            className={`${styles.btnDeploy} ${styles[`deploy_${deploy}`]}`}
            onClick={handleDeploy}
            disabled={deploy === 'deploying'}
          >
            {deploy === 'deploying' ? 'Deploying…'
              : deploy === 'ok'    ? '✓ Deployed'
              : deploy === 'error' ? '✗ Failed'
              : '⬆ Deploy to robix'}
          </button>
        </div>
      </div>

      {deployMsg && (
        <div className={`${styles.deployMsg} ${styles[`deployMsg_${deploy}`]}`}>
          {deployMsg}
        </div>
      )}

      <textarea
        className={styles.textarea}
        readOnly
        value={yaml}
        spellCheck={false}
      />

      <div className={styles.note}>
        <strong>Deploy</strong> writes to <code>~/.homeassistant/automations.yaml</code> on robix
        and reloads HA automations. Requires the backend service and <code>HA_TOKEN</code> in{' '}
        <code>/var/www/aqualight/.env</code>.
      </div>
    </div>
  )
}
