import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'
import StatusBadge   from '../../components/StatusBadge'
import PriorityBadge from '../../components/PriorityBadge'
import SlaIndicator  from '../../components/SlaIndicator'

const PRIORITIES = ['p1', 'p2', 'p3', 'p4']
const PAGE_SIZE  = 50

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function QueuePage() {
  const { user } = useAuth()

  const [tickets,   setTickets]   = useState([])
  const [tenants,   setTenants]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  // Filters (queue is always open only)
  const [priority,   setPriority]   = useState('')
  const [tenantId,   setTenantId]   = useState('')
  const [assignedMe, setAssignedMe] = useState(false)
  const [unassigned, setUnassigned] = useState(false)
  const [offset,     setOffset]     = useState(0)
  const [hasMore,    setHasMore]    = useState(false)

  // Load tenants once for filter dropdown
  useEffect(() => {
    if (['super_admin', 'supervisor'].includes(user?.role)) {
      api.listTenants().then(d => setTenants(d.tenants)).catch(() => {})
    }
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = { limit: PAGE_SIZE, offset, status: 'open' }
      if (priority)   params.priority      = priority
      if (tenantId)   params.tenant_id     = tenantId
      if (assignedMe) params.assigned_to_me = 1
      if (unassigned) params.unassigned     = 1

      const data = await api.listTickets(params)
      setTickets(data.tickets)
      setHasMore(data.tickets.length === PAGE_SIZE)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [priority, tenantId, assignedMe, unassigned, offset])

  useEffect(() => { load() }, [load])
  useEffect(() => { setOffset(0) }, [priority, tenantId, assignedMe, unassigned])

  async function claimTicket(ticketId, e) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await api.updateTicket(ticketId, {
        assigned_to_user_id: user.id,
        status: 'ce_pending',
      })
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Ticket Queue</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          <Link to="/queue/new" className="btn btn-primary btn-sm">+ New Ticket</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <select value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>

        {tenants.length > 0 && (
          <select value={tenantId} onChange={e => setTenantId(e.target.value)}>
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={assignedMe}
            onChange={e => { setAssignedMe(e.target.checked); if (e.target.checked) setUnassigned(false) }}
          />
          Assigned to me
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={unassigned}
            onChange={e => { setUnassigned(e.target.checked); if (e.target.checked) setAssignedMe(false) }}
          />
          Unassigned
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state">
            <h3>No tickets</h3>
            <p>Queue is empty for the current filters.</p>
          </div>
        ) : (
          <table className="ticket-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Tenant</th>
                <th>Priority</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Assigned</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id}>
                  <td><Link to={`/queue/${t.id}`} className="ticket-id">SR {t.id}</Link></td>
                  <td>
                    <Link to={`/queue/${t.id}`} style={{ fontWeight: 500 }}>
                      {t.subject}
                    </Link>
                    {t.created_by_name && (
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                        by {t.created_by_name}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>{t.tenant_name}</td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    {!['resolved','closed'].includes(t.status) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <SlaIndicator
                          label="1st resp"
                          createdAt={t.created_at}
                          dueAt={t.first_response_due_at}
                          metAt={t.first_response_met_at}
                        />
                        <SlaIndicator
                          label="Resolve"
                          createdAt={t.created_at}
                          dueAt={t.resolution_due_at}
                          metAt={null}
                        />
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {t.assigned_to_name
                      ? <span>{t.assigned_to_name}</span>
                      : <span style={{ color: 'var(--color-muted)' }}>—</span>
                    }
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(t.updated_at)}
                  </td>
                  <td>
                    {!t.assigned_to_user_id && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={e => claimTicket(t.id, e)}
                      >
                        Claim
                      </button>
                    )}
                    {t.assigned_to_user_id === user.id && (
                      <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>
                        ✓ Mine
                      </span>
                    )}
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
