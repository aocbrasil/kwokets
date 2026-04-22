import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'

const ROLES      = ['super_admin', 'supervisor', 'agent', 'customer']
const ROLE_LABELS = {
  super_admin: 'Super Admin',
  supervisor:  'Supervisor',
  agent:       'Agent',
  customer:    'Customer',
}

function roleBadge(role) {
  const colors = {
    super_admin: { bg: '#fee2e2', color: '#dc2626' },
    supervisor:  { bg: '#ede9fe', color: '#7c3aed' },
    agent:       { bg: '#dbeafe', color: '#2563eb' },
    customer:    { bg: '#f1f5f9', color: '#718096' },
  }
  const s = colors[role] || colors.customer
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      background: s.bg, color: s.color,
    }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

const BLANK_FORM = {
  email: '', full_name: '', role: 'customer', auth_type: 'local',
  password: '', ldap_dn: '', tenant_id: '', support_contract_number: '',
}

export default function UsersPage() {
  const { user } = useAuth()

  const [users,    setUsers]    = useState([])
  const [tenants,  setTenants]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  // Filters
  const [filterRole,   setFilterRole]   = useState('')
  const [filterTenant, setFilterTenant] = useState('')

  // Create form
  const [showForm,    setShowForm]    = useState(false)
  const [form,        setForm]        = useState(BLANK_FORM)
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState('')
  const [createErrors, setCreateErrors] = useState([])

  // Edit password modal
  const [editPwUser,  setEditPwUser]  = useState(null)
  const [newPw,       setNewPw]       = useState('')
  const [savingPw,    setSavingPw]    = useState(false)
  const [pwError,     setPwError]     = useState('')

  const isSuperAdmin = user?.role === 'super_admin'

  const loadTenants = useCallback(async () => {
    try {
      const data = await api.listTenants()
      setTenants(data.tenants)
    } catch {}
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (filterRole)   params.role      = filterRole
      if (filterTenant) params.tenant_id = filterTenant
      const data = await api.listUsers(params)
      setUsers(data.users)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterRole, filterTenant])

  useEffect(() => { loadTenants() }, [loadTenants])
  useEffect(() => { load() }, [load])

  function setF(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function createUser(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    setCreateErrors([])
    try {
      const payload = {
        email:     form.email.trim(),
        full_name: form.full_name.trim(),
        role:      form.role,
        auth_type: form.auth_type,
      }
      if (form.auth_type === 'local')  payload.password = form.password
      if (form.auth_type === 'ldap')   payload.ldap_dn  = form.ldap_dn.trim()
      if (form.role === 'customer') {
        payload.tenant_id              = parseInt(form.tenant_id, 10)
        payload.support_contract_number = form.support_contract_number.trim()
      }
      await api.createUser(payload)
      setForm(BLANK_FORM)
      setShowForm(false)
      load()
    } catch (err) {
      setCreateError(err.message)
      setCreateErrors(err.errors || [])
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(u) {
    try {
      await api.updateUser(u.id, { is_active: !u.is_active })
      load()
    } catch (err) { alert(err.message) }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (!newPw || newPw.length < 8) { setPwError('Min 8 characters'); return }
    setSavingPw(true)
    setPwError('')
    try {
      await api.updateUser(editPwUser.id, { password: newPw })
      setEditPwUser(null)
      setNewPw('')
    } catch (err) { setPwError(err.message) }
    finally { setSavingPw(false) }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Users</h1>
        {isSuperAdmin && (
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
            {showForm ? 'Cancel' : '+ New User'}
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body">
            <div style={{ fontWeight: 600, marginBottom: 16 }}>New User</div>
            {createError && <div className="alert alert-error">{createError}</div>}
            {createErrors.length > 0 && (
              <ul style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}>
                {createErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            <form onSubmit={createUser}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input type="text" className="form-control" value={form.full_name}
                    onChange={e => setF('full_name', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-control" value={form.email}
                    onChange={e => setF('email', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-control" value={form.role}
                    onChange={e => setF('role', e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Auth Type</label>
                  <select className="form-control" value={form.auth_type}
                    onChange={e => setF('auth_type', e.target.value)}
                    disabled={form.role === 'customer'}>
                    <option value="local">Local</option>
                    <option value="ldap">LDAP</option>
                  </select>
                </div>

                {form.auth_type === 'local' && (
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input type="password" className="form-control" value={form.password}
                      onChange={e => setF('password', e.target.value)}
                      minLength={8} placeholder="Min 8 characters" />
                  </div>
                )}
                {form.auth_type === 'ldap' && (
                  <div className="form-group">
                    <label className="form-label">LDAP DN</label>
                    <input type="text" className="form-control" value={form.ldap_dn}
                      onChange={e => setF('ldap_dn', e.target.value)}
                      placeholder="uid=john,ou=users,dc=example,dc=com" />
                  </div>
                )}

                {form.role === 'customer' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Tenant</label>
                      <select className="form-control" value={form.tenant_id}
                        onChange={e => setF('tenant_id', e.target.value)} required>
                        <option value="">— Select tenant —</option>
                        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Support Contract #</label>
                      <input type="text" className="form-control" value={form.support_contract_number}
                        onChange={e => setF('support_contract_number', e.target.value)} required />
                    </div>
                  </>
                )}
              </div>

              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? <span className="spinner" /> : 'Create User'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)}>
          <option value="">All tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" /></div>
        ) : users.length === 0 ? (
          <div className="empty-state"><h3>No users found</h3></div>
        ) : (
          <table className="ticket-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Tenant</th>
                <th>Auth</th>
                <th>Contract #</th>
                <th>Status</th>
                {isSuperAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                  <td style={{ fontSize: 13 }}>{u.email}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td style={{ fontSize: 13 }}>{u.tenant_name ?? '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--color-muted)', textTransform: 'uppercase' }}>
                    {u.auth_type}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                    {u.support_contract_number ?? '—'}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: u.is_active ? 'var(--color-success)' : 'var(--color-muted)',
                    }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {isSuperAdmin && (
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => toggleActive(u)}
                          disabled={u.id === user.id}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        {u.auth_type === 'local' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditPwUser(u); setNewPw(''); setPwError('') }}
                          >
                            Set PW
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Password modal */}
      {editPwUser && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
        }}>
          <div className="card" style={{ width: 360 }}>
            <div className="card-body">
              <div style={{ fontWeight: 600, marginBottom: 16 }}>
                Set password — {editPwUser.full_name}
              </div>
              {pwError && <div className="alert alert-error">{pwError}</div>}
              <form onSubmit={savePassword}>
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    minLength={8}
                    placeholder="Min 8 characters"
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={savingPw}>
                    {savingPw ? <span className="spinner" /> : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditPwUser(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
