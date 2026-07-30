import { useEffect, useState } from 'react'
import styles from './Presets.module.css'

interface PresetListEntry {
  name: string
  device: string
  saved_at: string
}

interface Props {
  device: 'biotope' | 'nano'
  currentState: unknown
  source: 'local' | 'ha'
  onLoad: (state: Record<string, unknown>) => void
}

type MsgKind = 'ok' | 'error' | 'info' | null

export default function Presets({ device, currentState, source, onLoad }: Props) {
  const [presets, setPresets] = useState<PresetListEntry[]>([])
  const [selected, setSelected] = useState<string>('')
  const [saveName, setSaveName] = useState('')
  const [msg, setMsg] = useState<string>('')
  const [msgKind, setMsgKind] = useState<MsgKind>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      const res = await fetch('/api/presets')
      const data = await res.json()
      setPresets((data.presets ?? []).filter((p: PresetListEntry) => p.device === device))
    } catch {
      setPresets([])
    }
  }

  useEffect(() => { refresh() }, [device])

  function flash(kind: Exclude<MsgKind, null>, text: string) {
    setMsgKind(kind); setMsg(text)
    setTimeout(() => { setMsg(''); setMsgKind(null) }, 4000)
  }

  async function handleSave() {
    const name = saveName.trim()
    if (!name) { flash('error', 'Give the preset a name first.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/presets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, device, state: currentState }),
      })
      const data = await res.json()
      if (data.ok) {
        flash('ok', `Saved "${name}".`)
        setSaveName('')
        setSelected(name)
        await refresh()
      } else {
        flash('error', data.error ?? 'Save failed.')
      }
    } catch {
      flash('error', 'Cannot reach backend.')
    }
    setBusy(false)
  }

  async function handleLoad() {
    if (!selected) return
    setBusy(true)
    try {
      const res  = await fetch(`/api/presets/${encodeURIComponent(selected)}`)
      const data = await res.json()
      if (data.state) {
        onLoad(data.state as Record<string, unknown>)
        flash('ok', `Loaded "${selected}".`)
      } else {
        flash('error', data.error ?? 'Load failed.')
      }
    } catch {
      flash('error', 'Cannot reach backend.')
    }
    setBusy(false)
  }

  async function handleDelete() {
    if (!selected) return
    if (!confirm(`Delete preset "${selected}"?`)) return
    setBusy(true)
    try {
      const res  = await fetch(`/api/presets/${encodeURIComponent(selected)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        flash('ok', `Deleted "${selected}".`)
        setSelected('')
        await refresh()
      } else {
        flash('error', data.error ?? 'Delete failed.')
      }
    } catch {
      flash('error', 'Cannot reach backend.')
    }
    setBusy(false)
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Presets</h3>
      <span className={`${styles.source} ${source === 'ha' ? styles.source_ha : ''}`}>
        {source === 'ha' ? '● loaded from HA' : '○ local defaults'}
      </span>

      <select
        className={styles.select}
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={busy}
      >
        <option value="">— saved presets —</option>
        {presets.map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <button className={styles.btn} onClick={handleLoad} disabled={!selected || busy}>
        Load
      </button>
      <button
        className={`${styles.btn} ${styles.btnDanger}`}
        onClick={handleDelete}
        disabled={!selected || busy}
      >
        Delete
      </button>

      <span className={styles.spacer} />

      <input
        className={styles.input}
        placeholder="new preset name"
        value={saveName}
        onChange={e => setSaveName(e.target.value)}
        disabled={busy}
      />
      <button className={styles.btn} onClick={handleSave} disabled={!saveName.trim() || busy}>
        Save current
      </button>

      {msg && (
        <div className={`${styles.msg} ${msgKind === 'ok' ? styles.msg_ok : msgKind === 'error' ? styles.msg_error : ''}`}>
          {msg}
        </div>
      )}
    </div>
  )
}
