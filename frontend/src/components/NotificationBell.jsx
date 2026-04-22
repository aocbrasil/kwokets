import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

const TYPE_LABELS = {
  sla_warn_first_response:   'First response SLA warning',
  sla_warn_resolution:       'Resolution SLA warning',
  sla_breach_first_response: 'First response SLA BREACHED',
  sla_breach_resolution:     'Resolution SLA BREACHED',
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen]                   = useState(false)
  const ref                               = useRef(null)
  const navigate                          = useNavigate()

  const load = useCallback(async () => {
    try {
      const data = await api.listNotifications()
      setNotifications(data.notifications)
    } catch {}
  }, [])

  // Poll every 60 seconds
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  // Close on outside click
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const unread = notifications.filter(n => !n.read_at)

  async function handleClick(n) {
    if (!n.read_at) {
      await api.markNotificationRead(n.id).catch(() => {})
      setNotifications(prev =>
        prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)
      )
    }
    setOpen(false)
    navigate(`/tickets/${n.ticket_id}`)
  }

  async function markAll() {
    await api.markAllNotificationsRead().catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        className="notif-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
      >
        🔔
        {unread.length > 0 && (
          <span className="notif-badge">{unread.length > 99 ? '99+' : unread.length}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <span>Notifications</span>
            {unread.length > 0 && (
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         color: 'var(--color-primary)', fontSize: 12, fontWeight: 500 }}
                onClick={markAll}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="notif-empty">No notifications</div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={`notif-item ${!n.read_at ? 'unread' : ''}`}
                  onClick={() => handleClick(n)}
                >
                  <span style={{ fontWeight: !n.read_at ? 600 : 400 }}>
                    {TYPE_LABELS[n.type] ?? n.type}
                  </span>
                  <span style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                    #{n.ticket_id} — {n.ticket_subject}
                  </span>
                  <span className="notif-time">{formatTime(n.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
