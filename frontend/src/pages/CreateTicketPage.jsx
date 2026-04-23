import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../lib/api'

const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

const TIER_LABELS = { basic: 'Basic', standard: 'Standard', prime: 'Prime' }

export default function CreateTicketPage() {
  const navigate = useNavigate()

  const [subject,     setSubject]     = useState('')
  const [description, setDescription] = useState('')
  const [priority,    setPriority]    = useState('p3')
  const [contractId,  setContractId]  = useState('')
  const [contracts,   setContracts]   = useState([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [files,       setFiles]       = useState([])
  const [error,       setError]       = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading,     setLoading]     = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    api.myContracts()
      .then(data => {
        setContracts(data.contracts)
        if (data.contracts.length === 1) setContractId(String(data.contracts[0].id))
      })
      .catch(err => setError(err.message))
      .finally(() => setContractsLoading(false))
  }, [])

  function handleFiles(e) {
    const chosen = Array.from(e.target.files)
    const oversized = chosen.filter(f => f.size > MAX_FILE_BYTES)
    if (oversized.length > 0) {
      setError(`File(s) exceed 100 MB limit: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...chosen.filter(f => !names.has(f.name))]
    })
    e.target.value = ''
  }

  function removeFile(name) {
    setFiles(prev => prev.filter(f => f.name !== name))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setFieldErrors({})

    const errs = {}
    if (!subject.trim())     errs.subject     = 'Required'
    if (!description.trim()) errs.description = 'Required'
    if (!contractId)         errs.contract    = 'Required'
    if (Object.keys(errs).length) { setFieldErrors(errs); return }

    setLoading(true)
    try {
      const ticket = await api.createTicket({ subject, description, priority, contract_id: Number(contractId) })

      // Upload attachments sequentially
      for (const file of files) {
        await api.uploadAttachment(ticket.id, file).catch(() => {})
      }

      navigate(`/tickets/${ticket.id}`)
    } catch (err) {
      setError(err.message)
      if (err.errors?.length) {
        const map = {}
        err.errors.forEach(e => { map[e.split(' ')[0].toLowerCase()] = e })
        setFieldErrors(map)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">New Ticket</h1>
        <Link to="/tickets" className="btn btn-secondary">Cancel</Link>
      </div>

      <div className="card">
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}

          {/* No active contract warning */}
          {!contractsLoading && contracts.length === 0 && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              No active contract found for your account. Please contact your account manager before opening a ticket.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Contract selector */}
            <div className="form-group">
              <label className="form-label" htmlFor="contract">Support Contract *</label>
              {contractsLoading ? (
                <span className="spinner" />
              ) : contracts.length === 1 ? (
                <div style={{ fontSize: 14, padding: '8px 0' }}>
                  <strong style={{ fontFamily: 'monospace' }}>{contracts[0].contract_code}</strong>
                  {' '}
                  <span style={{ fontSize: 12, color: 'var(--color-muted)', textTransform: 'capitalize' }}>
                    ({TIER_LABELS[contracts[0].tier] ?? contracts[0].tier})
                  </span>
                </div>
              ) : (
                <select id="contract" className="form-control" value={contractId}
                  onChange={e => setContractId(e.target.value)}>
                  <option value="">— Select contract —</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.contract_code} ({TIER_LABELS[c.tier] ?? c.tier})
                    </option>
                  ))}
                </select>
              )}
              {fieldErrors.contract && <div className="form-error">{fieldErrors.contract}</div>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="subject">Subject</label>
              <input
                id="subject"
                type="text"
                className="form-control"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={500}
                placeholder="Brief description of the issue"
                autoFocus
              />
              {fieldErrors.subject && (
                <div className="form-error">{fieldErrors.subject}</div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="priority">Priority</label>
              <select
                id="priority"
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
              <label className="form-label" htmlFor="description">Description</label>
              <textarea
                id="description"
                className="form-control"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={8}
                placeholder="Describe your issue in detail. Include any error messages, steps to reproduce, and expected vs actual behaviour."
              />
              {fieldErrors.description && (
                <div className="form-error">{fieldErrors.description}</div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Attachments</label>
              <label className="file-input-label">
                <span>📎 Add files</span>
                <input
                  type="file"
                  multiple
                  ref={fileRef}
                  onChange={handleFiles}
                />
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
                        onClick={() => removeFile(f.name)}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || contractsLoading || contracts.length === 0}
              >
                {loading ? <><span className="spinner" /> Submitting…</> : 'Submit Ticket'}
              </button>
              <Link to="/tickets" className="btn btn-secondary">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
