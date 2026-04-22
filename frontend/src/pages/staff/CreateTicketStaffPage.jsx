import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../../lib/api'

const MAX_FILE_BYTES = 100 * 1024 * 1024

export default function CreateTicketStaffPage() {
  const navigate = useNavigate()

  const [tenants,     setTenants]     = useState([])
  const [tenantId,    setTenantId]    = useState('')
  const [subject,     setSubject]     = useState('')
  const [description, setDescription] = useState('')
  const [priority,    setPriority]    = useState('p3')
  const [files,       setFiles]       = useState([])
  const [error,       setError]       = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading,     setLoading]     = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    api.listTenants()
      .then(d => setTenants(d.tenants.filter(t => t.is_active)))
      .catch(() => {})
  }, [])

  function handleFiles(e) {
    const chosen    = Array.from(e.target.files)
    const oversized = chosen.filter(f => f.size > MAX_FILE_BYTES)
    if (oversized.length) {
      setError(`File(s) exceed 100 MB: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...chosen.filter(f => !names.has(f.name))]
    })
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setFieldErrors({})

    const errs = {}
    if (!tenantId)       errs.tenant_id   = 'Required'
    if (!subject.trim()) errs.subject     = 'Required'
    if (!description.trim()) errs.description = 'Required'
    if (Object.keys(errs).length) { setFieldErrors(errs); return }

    setLoading(true)
    try {
      const ticket = await api.createTicket({
        tenant_id: parseInt(tenantId, 10),
        subject,
        description,
        priority,
      })

      for (const file of files) {
        await api.uploadAttachment(ticket.id, file).catch(() => {})
      }

      navigate(`/queue/${ticket.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">New Ticket</h1>
        <Link to="/queue" className="btn btn-secondary">Cancel</Link>
      </div>

      <div className="card">
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Tenant</label>
              <select
                className="form-control"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                style={{ maxWidth: 320 }}
              >
                <option value="">— Select tenant —</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {fieldErrors.tenant_id && <div className="form-error">{fieldErrors.tenant_id}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Subject</label>
              <input
                type="text"
                className="form-control"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={500}
                placeholder="Brief description of the issue"
                autoFocus
              />
              {fieldErrors.subject && <div className="form-error">{fieldErrors.subject}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Priority</label>
              <select
                className="form-control"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="p1">P1 — Critical</option>
                <option value="p2">P2 — High</option>
                <option value="p3">P3 — Medium</option>
                <option value="p4">P4 — Low</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-control"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={8}
                placeholder="Describe the issue in detail."
              />
              {fieldErrors.description && <div className="form-error">{fieldErrors.description}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Attachments</label>
              <label className="file-input-label">
                <span>📎 Add files</span>
                <input type="file" multiple ref={fileRef} onChange={handleFiles} />
              </label>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>
                Max 100 MB per file
              </div>
              {files.length > 0 && (
                <div className="attachments-list" style={{ marginTop: 10 }}>
                  {files.map(f => (
                    <span key={f.name} className="attachment-chip">
                      📄 {f.name}
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer',
                                 color: 'var(--color-muted)', fontSize: 12, padding: 0 }}
                        onClick={() => setFiles(p => p.filter(x => x.name !== f.name))}
                      >✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" /> Submitting…</> : 'Submit Ticket'}
              </button>
              <Link to="/queue" className="btn btn-secondary">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
