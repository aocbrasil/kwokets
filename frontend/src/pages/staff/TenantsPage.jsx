import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'

const PRIORITIES = ['p1', 'p2', 'p3', 'p4']
const PRIORITY_LABELS = { p1: 'P1 Critical', p2: 'P2 High', p3: 'P3 Medium', p4: 'P4 Low' }

function SlaRulesEditor({ tenantId }) {
  const [rules,   setRules]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(null) // priority being saved
  const [error,   setError]   = useState('')
  const [edits,   setEdits]   = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listSlaRules(tenantId)
      setRules(data.sla_rules)
      // Seed edits with existing rules
      const map = {}
      data.sla_rules.forEach(r => {
        map[r.priority] = {
          first_response_minutes: r.first_response_minutes,
          resolution_minutes:     r.resolution_minutes,
          warn_before_minutes:    r.warn_before_minutes,
        }
      })
      // Fill in missing priorities with defaults
      PRIORITIES.forEach(p => {
        if (!map[p]) map[p] = { first_response_minutes: 60, resolution_minutes: 480, warn_before_minutes: 30 }
      })
      setEdits(map)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function saveRule(priority) {
    setSaving(priority)
    setError('')
    try {
      await api.upsertSlaRule(tenantId, { priority, ...edits[priority] })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(null)
    }
  }

  function setField(priority, field, value) {
    setEdits(prev => ({
      ...prev,
      [priority]: { ...prev[priority], [field]: parseInt(value, 10) || 0 },
    }))
  }

  if (loading) return <div style={{ padding: 16 }}><span className="spinner" /></div>

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--color-muted)',
                         fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Priority</th>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--color-muted)',
                         fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>First Response (min)</th>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--color-muted)',
                         fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Resolution (min)</th>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--color-muted)',
                         fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Warn Before (min)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {PRIORITIES.map(p => {
            const e = edits[p] || {}
            return (
              <tr key={p} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '10px 0', fontWeight: 600 }}>
                  <span className={`badge badge-${p}`}>{PRIORITY_LABELS[p]}</span>
                </td>
                <td style={{ padding: '10px 8px 10px 0' }}>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    style={{ width: 90 }}
                    value={e.first_response_minutes ?? ''}
                    onChange={ev => setField(p, 'first_response_minutes', ev.target.value)}
                  />
                </td>
                <td style={{ padding: '10px 8px 10px 0' }}>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    style={{ width: 90 }}
                    value={e.resolution_minutes ?? ''}
                    onChange={ev => setField(p, 'resolution_minutes', ev.target.value)}
                  />
                </td>
                <td style={{ padding: '10px 8px 10px 0' }}>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    style={{ width: 80 }}
                    value={e.warn_before_minutes ?? 30}
                    onChange={ev => setField(p, 'warn_before_minutes', ev.target.value)}
                  />
                </td>
                <td style={{ padding: '10px 0' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => saveRule(p)}
                    disabled={saving === p}
                  >
                    {saving === p ? <span className="spinner" /> : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function TenantsPage() {
  const { user } = useAuth()

  const [tenants,     setTenants]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [expandedId,  setExpandedId]  = useState(null)

  // New tenant form
  const [showForm,    setShowForm]    = useState(false)
  const [newName,     setNewName]     = useState('')
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState('')

  const isSuperAdmin = user?.role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listTenants()
      setTenants(data.tenants)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createTenant(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      await api.createTenant({ name: newName.trim() })
      setNewName('')
      setShowForm(false)
      load()
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(tenant) {
    try {
      await api.updateTenant(tenant.id, { is_active: !tenant.is_active })
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Tenants</h1>
        {isSuperAdmin && (
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
            {showForm ? 'Cancel' : '+ New Tenant'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body">
            {createError && <div className="alert alert-error">{createError}</div>}
            <form onSubmit={createTenant} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Tenant Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Acme Corp"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
                {creating ? <span className="spinner" /> : 'Create'}
              </button>
            </form>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><span className="spinner" /></div>
      ) : tenants.length === 0 ? (
        <div className="empty-state">
          <h3>No tenants yet</h3>
          <p>Create your first tenant to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tenants.map(t => (
            <div key={t.id} className="card">
              <div
                style={{
                  padding: '14px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              >
                <span style={{ fontWeight: 600, flex: 1 }}>{t.name}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 999,
                  background: t.is_active ? '#dcfce7' : '#f1f5f9',
                  color: t.is_active ? 'var(--color-success)' : 'var(--color-muted)',
                }}>
                  {t.is_active ? 'Active' : 'Inactive'}
                </span>
                {isSuperAdmin && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={e => { e.stopPropagation(); toggleActive(t) }}
                    >
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-sm"
                      style={{ background: 'var(--color-danger)', color: '#fff',
                               borderColor: 'var(--color-danger)' }}
                      onClick={async e => {
                        e.stopPropagation()
                        if (!window.confirm(
                          `Permanently delete tenant "${t.name}"?\n\nThis will delete ALL tickets, messages and customer users belonging to this tenant. This cannot be undone.`
                        )) return
                        try {
                          await api.deleteTenant(t.id)
                          load()
                        } catch (err) {
                          alert(err.message)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
                <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                  {expandedId === t.id ? '▲' : '▼'} SLA Rules
                </span>
              </div>

              {expandedId === t.id && (
                <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px 20px' }}>
                  <SlaRulesEditor tenantId={t.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
