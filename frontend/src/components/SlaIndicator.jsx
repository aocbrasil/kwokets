/**
 * Shows a thin progress bar and time-remaining text for an SLA due date.
 * pct: 0-100 (100 = full time remaining, 0 = breached)
 */
function pctRemaining(createdAt, dueAt) {
  if (!dueAt) return null
  const total   = new Date(dueAt) - new Date(createdAt)
  const elapsed = Date.now()     - new Date(createdAt)
  return Math.max(0, Math.min(100, 100 - (elapsed / total) * 100))
}

function formatRemaining(dueAt) {
  if (!dueAt) return null
  const diff = new Date(dueAt) - Date.now()
  if (diff < 0) return 'Breached'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0)   return `${h}h ${m}m`
  return `${m}m`
}

export default function SlaIndicator({ label, createdAt, dueAt, metAt }) {
  if (!dueAt) return null

  if (metAt) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-success)' }}>
        {label}: met
      </div>
    )
  }

  const pct      = pctRemaining(createdAt, dueAt)
  const timeLeft = formatRemaining(dueAt)
  const cls      = pct === null ? '' : pct > 30 ? 'sla-ok' : pct > 0 ? 'sla-warning' : 'sla-breach'
  const color    = pct === null ? '' : pct > 30 ? 'var(--color-success)' : pct > 0 ? 'var(--color-warning)' : 'var(--color-danger)'

  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 2 }}>
        {label}:{' '}
        <span style={{ fontWeight: 600, color }}>{timeLeft}</span>
      </div>
      <div className="sla-bar">
        <div className={`sla-fill ${cls}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  )
}
