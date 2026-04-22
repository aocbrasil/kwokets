import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import StatusBadge   from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'

const STATUSES  = ['', 'open', 'in_progress', 'customer_pending', 'monitoring', 'resolved', 'closed']
const PRIORITIES = ['', 'p1', 'p2', 'p3', 'p4']

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const PAGE_SIZE = 25

export default function MyTicketsPage() {
  const [tickets, setTickets]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [status, setStatus]     = useState('')
  const [priority, setPriority] = useState('')
  const [offset, setOffset]     = useState(0)
  const [hasMore, setHasMore]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { limit: PAGE_SIZE, offset }
      if (status)   params.status   = status
      if (priority) params.priority = priority
      const data = await api.listTickets(params)
      setTickets(data.tickets)
      setHasMore(data.tickets.length === PAGE_SIZE)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [status, priority, offset])

  useEffect(() => { load() }, [load])

  // Reset offset when filters change
  useEffect(() => { setOffset(0) }, [status, priority])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">My Tickets</h1>
        <Link to="/tickets/new" className="btn btn-primary">+ New Ticket</Link>
      </div>

      <div className="filters-bar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>

        <select value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.filter(Boolean).map(p => (
            <option key={p} value={p}>{p.toUpperCase()}</option>
          ))}
        </select>

        <button className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state">
            <h3>No tickets found</h3>
            <p>Create your first ticket to get started.</p>
            <br />
            <Link to="/tickets/new" className="btn btn-primary">Create Ticket</Link>
          </div>
        ) : (
          <table className="ticket-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id}>
                  <td><Link to={`/tickets/${t.id}`} className="ticket-id">SR {t.id}</Link></td>
                  <td>
                    <Link to={`/tickets/${t.id}`}>{t.subject}</Link>
                  </td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                    {formatDate(t.created_at)}
                  </td>
                  <td style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                    {formatDate(t.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && (tickets.length > 0 || offset > 0) && (
        <div className="pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={offset === 0}
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </button>
          <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
            {offset + 1}–{offset + tickets.length}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={!hasMore}
            onClick={() => setOffset(o => o + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      )}
    </>
  )
}
