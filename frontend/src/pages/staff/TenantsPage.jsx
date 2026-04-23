import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'

const PRIORITIES = ['p1', 'p2', 'p3', 'p4']
const PRIORITY_LABELS = { p1: 'P1 Critical', p2: 'P2 High', p3: 'P3 Medium', p4: 'P4 Low' }

const TIER_LABELS = { basic: 'Basic', standard: 'Standard', prime: 'Prime' }
const TIER_COLORS = {
  basic:    { bg: '#f1f5f9', color: '#475569' },
  standard: { bg: '#dbeafe', color: '#1d4ed8' },
  prime:    { bg: '#fef3c7', color: '#92400e' },
}

// Default SLA values per tier per priority
const TIER_DEFAULTS = {
  basic:    { p1: [240,960,30],  p2: [480,1920,30],  p3: [1440,5760,30],  p4: [2880,11520,30] },
  standard: { p1: [120,480,30],  p2: [240,960,30],   p3: [480,2880,30],   p4: [960,5760,30]   },
  prime:    { p1: [60,240,30],   p2: [120,480,30],   p3: [240,1440,30],   p4: [480,2880,30]   },
}

function slaDefaults(tier) {
  const defs = TIER_DEFAULTS[tier] || TIER_DEFAULTS.basic
  return PRIORITIES.map(p => ({
    priority: p,
    first_response_minutes: defs[p][0],
    resolution_minutes:     defs[p][1],
    warn_before_minutes:    defs[p][2],
  }))
}

/* ── SLA Rules Editor (tenant-level) ──────────────────────────────── */
function SlaRulesEditor({ tenantId }) {
  const [rules,   setRules]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(null)
  const [error,   setError]   = useState('')
  const [edits,   setEdits]   = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listSlaRules(tenantId)
      setRules(data.sla_rules)
      const map = {}
      data.sla_rules.forEach(r => {
        map[r.priority] = {
          first_response_minutes: r.first_response_minutes,
          resolution_minutes:     r.resolution_minutes,
          warn_before_minutes:    r.warn_before_minutes,
        }
      })
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
            {['Priority','First Response (min)','Resolution (min)','Warn Before (min)',''].map(h => (
              <th key={h} style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--color-muted)',
                           fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
            ))}
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
                {[['first_response_minutes',90],['resolution_minutes',90],['warn_before_minutes',80]].map(([field, w]) => (
                  <td key={field} style={{ padding: '10px 8px 10px 0' }}>
                    <input type="number" min="1" className="form-control" style={{ width: w }}
                      value={e[field] ?? ''}
                      onChange={ev => setField(p, field, ev.target.value)} />
                  </td>
                ))}
                <td style={{ padding: '10px 0' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => saveRule(p)} disabled={saving === p}>
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

/* ── Contract SLA mini-editor (inline within contract) ──────────────── */
function ContractSlaEditor({ slaRules, onChange }) {
  const map = {}
  slaRules.forEach(r => { map[r.priority] = r })
  PRIORITIES.forEach(p => {
    if (!map[p]) map[p] = { priority: p, first_response_minutes: 60, resolution_minutes: 480, warn_before_minutes: 30 }
  })

  function setField(priority, field, value) {
    const updated = PRIORITIES.map(p => ({
      ...map[p],
      ...(p === priority ? { [field]: parseInt(value, 10) || 0 } : {}),
    }))
    onChange(updated)
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {['Priority','1st Resp (min)','Resolution (min)','Warn (min)'].map(h => (
            <th key={h} style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--color-muted)',
                         fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PRIORITIES.map(p => {
          const e = map[p]
          return (
            <tr key={p} style={{ borderTop: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px 0' }}>
                <span className={`badge badge-${p}`}>{p.toUpperCase()}</span>
              </td>
              {[['first_response_minutes',80],['resolution_minutes',80],['warn_before_minutes',70]].map(([field, w]) => (
                <td key={field} style={{ padding: '8px 8px 8px 0' }}>
                  <input type="number" min="1" className="form-control" style={{ width: w }}
                    value={e[field] ?? ''}
                    onChange={ev => setField(p, field, ev.target.value)} />
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ── Contracts panel ─────────────────────────────────────────────────── */
function ContractsPanel({ tenantId, isSuperAdmin, canEdit }) {
  const [contracts, setContracts] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState(null)   // contract being edited
  const [saving,    setSaving]    = useState(false)

  // New/edit form state
  const [form, setForm] = useState({
    contract_code: '', tier: 'basic', start_date: '', end_date: '',
    notes: '', customer_terms: '', sla_rules: slaDefaults('basic'),
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listContracts(tenantId)
      setContracts(data.contracts)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm({
      contract_code: '', tier: 'basic', start_date: '', end_date: '',
      notes: '', customer_terms: '', sla_rules: slaDefaults('basic'),
    })
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(c) {
    setForm({
      contract_code:  c.contract_code,
      tier:           c.tier,
      start_date:     c.start_date?.slice(0, 10) ?? '',
      end_date:       c.end_date?.slice(0, 10)   ?? '',
      notes:          c.notes          ?? '',
      customer_terms: c.customer_terms ?? '',
      sla_rules:      c.sla_rules.length ? c.sla_rules : slaDefaults(c.tier),
    })
    setEditId(c.id)
    setShowForm(true)
  }

  function setTier(tier) {
    setForm(f => ({ ...f, tier, sla_rules: slaDefaults(tier) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      let data
      if (editId) {
        data = await api.updateContract(tenantId, editId, form)
      } else {
        data = await api.createContract(tenantId, form)
      }
      setContracts(data.contracts)
      setShowForm(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate(c) {
    try {
      const data = await api.activateContract(tenantId, c.id)
      setContracts(data.contracts)
    } catch (err) { alert(err.message) }
  }

  async function handleDeactivate(c) {
    try {
      const data = await api.deactivateContract(tenantId, c.id)
      setContracts(data.contracts)
    } catch (err) { alert(err.message) }
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete contract "${c.contract_code}"?`)) return
    try {
      const data = await api.deleteContract(tenantId, c.id)
      setContracts(data.contracts)
    } catch (err) { alert(err.message) }
  }

  if (loading) return <div style={{ padding: 16 }}><span className="spinner" /></div>

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {canEdit && !showForm && (
        <div style={{ marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>+ New Contract</button>
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)',
                      borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>
            {editId ? 'Edit Contract' : 'New Contract'}
          </div>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Contract Code *</label>
                <input className="form-control" value={form.contract_code} required
                  onChange={e => setForm(f => ({ ...f, contract_code: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tier *</label>
                <select className="form-control" value={form.tier} onChange={e => setTier(e.target.value)}>
                  {Object.entries(TIER_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Start Date *</label>
                <input type="date" className="form-control" value={form.start_date} required
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">End Date</label>
                <input type="date" className="form-control" value={form.end_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Notes</label>
              <textarea className="form-control" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">Customer Terms</label>
              <textarea className="form-control" rows={3} value={form.customer_terms}
                onChange={e => setForm(f => ({ ...f, customer_terms: e.target.value }))} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--color-muted)',
                            textTransform: 'uppercase', letterSpacing: '.4px' }}>SLA Rules</div>
              <ContractSlaEditor
                slaRules={form.sla_rules}
                onChange={rules => setForm(f => ({ ...f, sla_rules: rules }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? <span className="spinner" /> : (editId ? 'Save Changes' : 'Create Contract')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Contracts list */}
      {contracts.length === 0 ? (
        <p style={{ color: 'var(--color-muted)', fontSize: 13 }}>No contracts yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {contracts.map(c => {
            const tc = TIER_COLORS[c.tier] || TIER_COLORS.basic
            const isExpired = c.end_date && new Date(c.end_date) < new Date()
            return (
              <div key={c.id} style={{
                border: `1px solid ${c.is_active ? 'var(--color-success)' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: c.is_active ? '#f0fdf4' : 'var(--color-surface)',
                padding: '12px 16px',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>
                    {c.contract_code}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px',
                                 borderRadius: 999, background: tc.bg, color: tc.color }}>
                    {TIER_LABELS[c.tier]}
                  </span>
                  {c.is_active && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px',
                                   borderRadius: 999, background: '#dcfce7', color: 'var(--color-success)' }}>
                      Active
                    </span>
                  )}
                  {isExpired && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px',
                                   borderRadius: 999, background: '#fee2e2', color: 'var(--color-danger)' }}>
                      Expired
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                    {c.start_date?.slice(0,10)} — {c.end_date?.slice(0,10) ?? 'ongoing'}
                  </span>

                  {canEdit && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {!c.is_active && (
                        <button className="btn btn-sm"
                          style={{ background: 'var(--color-success)', color: '#fff',
                                   borderColor: 'var(--color-success)' }}
                          onClick={() => handleActivate(c)}>
                          Activate
                        </button>
                      )}
                      {c.is_active && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleDeactivate(c)}>
                          Deactivate
                        </button>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>
                        Edit
                      </button>
                      {isSuperAdmin && !c.is_active && (
                        <button className="btn btn-sm"
                          style={{ background: 'var(--color-danger)', color: '#fff',
                                   borderColor: 'var(--color-danger)' }}
                          onClick={() => handleDelete(c)}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Notes + Terms */}
                {(c.notes || c.customer_terms) && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {c.notes && (
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--color-muted)', fontWeight: 600 }}>Notes: </span>
                        {c.notes}
                      </div>
                    )}
                    {c.customer_terms && (
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--color-muted)', fontWeight: 600 }}>Terms: </span>
                        {c.customer_terms}
                      </div>
                    )}
                  </div>
                )}

                {/* SLA rules summary */}
                {c.sla_rules.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {c.sla_rules.map(r => (
                      <span key={r.priority} style={{ fontSize: 11, background: 'var(--color-bg)',
                                                      border: '1px solid var(--color-border)',
                                                      borderRadius: 4, padding: '2px 8px' }}>
                        <strong>{r.priority.toUpperCase()}</strong>: {r.first_response_minutes}m / {r.resolution_minutes}m
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────────────── */
export default function TenantsPage() {
  const { user } = useAuth()

  const [tenants,     setTenants]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [expandedId,  setExpandedId]  = useState(null)
  const [activeTab,   setActiveTab]   = useState({}) // tenantId → 'sla' | 'contracts'

  const [showForm,    setShowForm]    = useState(false)
  const [newName,     setNewName]     = useState('')
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState('')

  const isSuperAdmin = user?.role === 'super_admin'
  const canEdit      = ['super_admin', 'supervisor'].includes(user?.role)

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

  function getTab(tenantId) {
    return activeTab[tenantId] ?? 'contracts'
  }
  function setTab(tenantId, tab) {
    setActiveTab(prev => ({ ...prev, [tenantId]: tab }))
  }

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
                <input type="text" className="form-control" value={newName}
                  onChange={e => setNewName(e.target.value)} placeholder="Acme Corp" autoFocus />
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
              {/* Tenant header row */}
              <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12,
                            cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              >
                <span style={{ fontWeight: 600, flex: 1 }}>{t.name}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                  background: t.is_active ? '#dcfce7' : '#f1f5f9',
                  color: t.is_active ? 'var(--color-success)' : 'var(--color-muted)',
                }}>
                  {t.is_active ? 'Active' : 'Inactive'}
                </span>
                {isSuperAdmin && (
                  <>
                    <button className="btn btn-secondary btn-sm"
                      onClick={e => { e.stopPropagation(); toggleActive(t) }}>
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="btn btn-sm"
                      style={{ background: 'var(--color-danger)', color: '#fff',
                               borderColor: 'var(--color-danger)' }}
                      onClick={async e => {
                        e.stopPropagation()
                        if (!window.confirm(
                          `Permanently delete tenant "${t.name}"?\n\nThis will delete ALL tickets, messages and customer users. This cannot be undone.`
                        )) return
                        try {
                          await api.deleteTenant(t.id)
                          load()
                        } catch (err) { alert(err.message) }
                      }}>
                      Delete
                    </button>
                  </>
                )}
                <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                  {expandedId === t.id ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded section with tabs */}
              {expandedId === t.id && (
                <div style={{ borderTop: '1px solid var(--color-border)' }}>
                  {/* Tabs */}
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)',
                                padding: '0 20px', gap: 0 }}>
                    {[['contracts','Contracts'],['sla','SLA Rules']].map(([tab, label]) => (
                      <button key={tab}
                        onClick={() => setTab(t.id, tab)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '10px 16px', fontSize: 13, fontWeight: 500,
                          borderBottom: getTab(t.id) === tab
                            ? '2px solid var(--color-primary)'
                            : '2px solid transparent',
                          color: getTab(t.id) === tab ? 'var(--color-primary)' : 'var(--color-muted)',
                          marginBottom: -1,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div style={{ padding: '16px 20px' }}>
                    {getTab(t.id) === 'sla' ? (
                      <SlaRulesEditor tenantId={t.id} />
                    ) : (
                      <ContractsPanel
                        tenantId={t.id}
                        isSuperAdmin={isSuperAdmin}
                        canEdit={canEdit}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
