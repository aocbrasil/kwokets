import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'
import StatusBadge   from '../../components/StatusBadge'
import PriorityBadge from '../../components/PriorityBadge'
import SlaIndicator  from '../../components/SlaIndicator'

// All active non-open states
const BACKLOG_STATUSES = ['ce_pending', 'customer_pending', 'third_party_pending', 'monitoring', 'close_pending', 'resolved']
const PRIORITIES       = ['p1', 'p2', 'p3', 'p4']
const PAGE_SIZE        = 50
const CLOSED_PAGE_SIZE = 100

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function BacklogPage() {
  const { user } = useAuth()

  const [tickets,        setTickets]        = useState([])
  const [closedTickets,  setClosedTickets]  = useState([])
  const [tenants,        setTenants]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')
  const [closedExpanded, setClosedExpanded] = useState(false)

  const canSeeAll = ['super_admin', 'supervisor'].includes(user?.role)

  // Filters
  const [status,     setStatus]     = useState('')
  const [priority,   setPriority]   = useState('')
  const [tenantId,   setTenantId]   = useState('')
  const [assignedMe, setAssignedMe] = useState(!canSeeAll)
  const [offset,     setOffset]     = useState(0)
  const [hasMore,    setHasMore]    = useState(false)

  useEffect(() => {
    if (['super_admin', 'supervisor'].includes(user?.role)) {
      api.listTenants().then(d => setTenants(d.tenants)).catch(() => {})
    }
  }, [user])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const priorityOrder = { p1: 0, p2: 1, p3: 2, p4: 3 }

      // Active backlog statuses
      const activeStatuses = status ? [status] : BACKLOG_STATUSES
      const activePromises = activeStatuses.map(s => {
        const params = { limit: PAGE_SIZE, offset: 0, status: s }
        if (priority)   params.priority       = priority
        if (tenantId)   params.tenant_id      = tenantId
        if (assignedMe) params.assigned_to_me = 1
        return api.listTickets(params).then(d => d.tickets)
      })
      const activeResults = await Promise.all(activePromises)
      const all = activeResults.flat()
      all.sort((a, b) => {
        const pd = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (pd !== 0) return pd
        return new Date(b.updated_at) - new Date(a.updated_at)
      })
      setTickets(all)

      // Closed tickets — only for supervisor/super_admin, only when no status filter or filter=closed
      if (canSeeAll && (!status || status === 'closed')) {
        const closedParams = { limit: CLOSED_PAGE_SIZE, offset: 0, status: 'closed' }
        if (priority) closedParams.priority  = priority
        if (tenantId) closedParams.tenant_id = tenantId
        const closedData = await api.listTickets(closedParams)
        const closed = closedData.tickets
        closed.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        setClosedTickets(closed)
      } else {
        setClosedTickets([])
      }

      setHasMore(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [status, priority, tenantId, assignedMe, offset, canSeeAll])

  useEffect(() => { load() }, [load])
  useEffect(() => { setOffset(0) }, [status, priority, tenantId, assignedMe])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Backlog</h1>
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
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All backlog statuses</option>
          {BACKLOG_STATUSES.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

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
            onChange={e => setAssignedMe(e.target.checked)}
          />
          Assigned to me
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
            <h3>Backlog is empty</h3>
            <p>No tickets in progress for the current filters.</p>
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
                    {!['resolved', 'close_pending', 'customer_pending', 'third_party_pending', 'monitoring'].includes(t.status) && (
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
                    {t.status === 'close_pending' && (
                      <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                        SLA paused
                      </span>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Closed tickets section — supervisor / super_admin only */}
      {canSeeAll && (!status || status === 'closed') && (
        <div style={{ marginTop: 32 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, cursor: 'pointer' }}
            onClick={() => setClosedExpanded(e => !e)}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
              {closedExpanded ? '▼' : '▶'} Closed Tickets
            </h2>
            <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
              {closedTickets.length} ticket{closedTickets.length !== 1 ? 's' : ''}
            </span>
          </div>

          {closedExpanded && (
            <div className="card">
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" /></div>
              ) : closedTickets.length === 0 ? (
                <div className="empty-state">
                  <h3>No closed tickets</h3>
                  <p>No closed tickets for the current filters.</p>
                </div>
              ) : (
                <table className="ticket-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Subject</th>
                      <th>Tenant</th>
                      <th>Priority</th>
                      <th>Assigned</th>
                      <th>Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedTickets.map(t => (
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
                        <td style={{ fontSize: 13 }}>
                          {t.assigned_to_name
                            ? <span>{t.assigned_to_name}</span>
                            : <span style={{ color: 'var(--color-muted)' }}>—</span>
                          }
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                          {formatDate(t.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
