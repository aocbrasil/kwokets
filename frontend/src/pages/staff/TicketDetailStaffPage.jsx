import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { api }     from '../../lib/api'
import StatusBadge   from '../../components/StatusBadge'
import PriorityBadge from '../../components/PriorityBadge'
import SlaIndicator  from '../../components/SlaIndicator'

const MAX_FILE_BYTES = 100 * 1024 * 1024

// Valid transitions (mirrors backend)
const STATUS_TRANSITIONS = {
  open:                ['ce_pending', 'close_pending', 'closed'],
  ce_pending:          ['open', 'customer_pending', 'third_party_pending', 'monitoring', 'resolved', 'close_pending', 'closed'],
  customer_pending:    ['ce_pending', 'resolved', 'close_pending', 'closed'],
  third_party_pending: ['ce_pending', 'resolved', 'close_pending', 'closed'],
  monitoring:          ['ce_pending', 'resolved', 'close_pending', 'closed'],
  resolved:            ['closed', 'open', 'close_pending'],
  close_pending:       ['ce_pending', 'closed'],
  closed:              [],
}

const STATUS_LABELS = {
  open:                'Open',
  ce_pending:          'CE Pending',
  customer_pending:    'Customer Pending',
  third_party_pending: '3rd Party Pending',
  monitoring:          'Monitoring',
  resolved:            'Resolved',
  close_pending:       'Closure Requested',
  closed:              'Closed',
}

const PRIORITY_LABELS = { p1: 'P1 — Critical', p2: 'P2 — High', p3: 'P3 — Medium', p4: 'P4 — Low' }

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function MessageItem({ msg, currentUserId, collapsed, onToggle }) {
  const isSelf     = msg.user_id === currentUserId
  const isInternal = msg.is_internal
  const isStaff    = ['agent', 'supervisor', 'super_admin'].includes(msg.user_role)

  return (
    <div className={`message-item ${isSelf ? 'is-self' : ''} ${isInternal ? 'is-internal' : ''}`}>
      <div className={`message-avatar ${isStaff ? 'avatar-staff' : ''} ${isSelf ? 'avatar-self' : ''}`}>
        {initials(msg.user_name)}
      </div>
      <div className="message-bubble">
        <div
          className="message-meta"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={onToggle}
        >
          <strong>{msg.user_name}</strong>
          <span style={{ fontSize: 11, color: 'var(--color-muted)',
                         background: isStaff ? '#ede9fe' : 'var(--color-bg)',
                         padding: '1px 6px', borderRadius: 4 }}>
            {msg.user_role?.replace('_', ' ')}
          </span>
          {isInternal && <span className="internal-tag">Internal note</span>}
          {msg.source === 'email' && (
            <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>via email</span>
          )}
          <span style={{ marginLeft: 'auto' }}>{formatDate(msg.created_at)}</span>
          <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
            {collapsed ? '▶' : '▼'}
          </span>
        </div>
        {!collapsed && <div className="message-body">{msg.body}</div>}
      </div>
    </div>
  )
}

export default function TicketDetailStaffPage() {
  const { id }   = useParams()
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const fileRef  = useRef(null)

  const [ticket,      setTicket]      = useState(null)
  const [messages,    setMessages]    = useState([])
  const [attachments, setAttachments] = useState([])
  const [agents,      setAgents]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')

  // Reply state
  const [replyBody,    setReplyBody]    = useState('')
  const [isInternal,   setIsInternal]   = useState(false)
  const [replyFiles,   setReplyFiles]   = useState([])
  const [sending,      setSending]      = useState(false)
  const [replyError,   setReplyError]   = useState('')

  // Sidebar edit state
  const [editStatus,   setEditStatus]   = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [editAssignee, setEditAssignee] = useState('')
  const [savingMeta,   setSavingMeta]   = useState(false)
  const [metaError,    setMetaError]    = useState('')
  const [metaSuccess,  setMetaSuccess]  = useState('')

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState('')
  const [savingTitle,  setSavingTitle]  = useState(false)

  const [collapsedIds, setCollapsedIds] = useState(new Set())

  function toggleMessage(msgId) {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      next.has(msgId) ? next.delete(msgId) : next.add(msgId)
      return next
    })
  }
  function collapseAll() {
    setCollapsedIds(new Set(messages.filter(m => m.source !== 'system').map(m => m.id)))
  }
  function expandAll() {
    setCollapsedIds(new Set())
  }

  const loadTicket = useCallback(async () => {
    try {
      const [t, m, a] = await Promise.all([
        api.getTicket(id),
        api.listMessages(id),
        api.listAttachments(id),
      ])
      setTicket(t)
      setMessages(m.messages)
      setAttachments(a.attachments)
      setEditStatus(t.status)
      setEditPriority(t.priority)
      setEditAssignee(t.assigned_to_user_id ?? '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  // Load agents list for assignment dropdown
  useEffect(() => {
    api.listUsers({ role: 'agent' }).then(d => {
      setAgents(d.users)
    }).catch(() => {})
  }, [])

  useEffect(() => { loadTicket() }, [loadTicket])

  // ---- Save metadata changes ----
  async function saveMeta() {
    setSavingMeta(true)
    setMetaError('')
    setMetaSuccess('')
    try {
      const patch = {}
      if (editStatus   !== ticket.status)           patch.status             = editStatus
      if (editPriority !== ticket.priority)          patch.priority           = editPriority
      const assigneeVal = editAssignee === '' ? null : parseInt(editAssignee, 10)
      if (assigneeVal !== (ticket.assigned_to_user_id ?? null))
        patch.assigned_to_user_id = assigneeVal

      if (Object.keys(patch).length === 0) {
        setMetaSuccess('No changes.')
        setSavingMeta(false)
        return
      }
      await api.updateTicket(id, patch)
      await loadTicket()
      setMetaSuccess('Saved.')
      setTimeout(() => setMetaSuccess(''), 2000)
    } catch (err) {
      setMetaError(err.message)
    } finally {
      setSavingMeta(false)
    }
  }

  // ---- Reply ----
  function handleReplyFiles(e) {
    const chosen    = Array.from(e.target.files)
    const oversized = chosen.filter(f => f.size > MAX_FILE_BYTES)
    if (oversized.length) {
      setReplyError(`File(s) exceed 100 MB: ${oversized.map(f => f.name).join(', ')}`)
      return
    }
    setReplyFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...chosen.filter(f => !names.has(f.name))]
    })
    e.target.value = ''
  }

  async function handleReply(e) {
    e.preventDefault()
    if (!replyBody.trim()) return
    setReplyError('')
    setSending(true)
    try {
      const msg = await api.createMessage(id, { body: replyBody, is_internal: isInternal })
      for (const file of replyFiles) {
        await api.uploadAttachment(id, file, msg.id).catch(() => {})
      }
      setReplyBody('')
      setReplyFiles([])
      await loadTicket()
    } catch (err) {
      setReplyError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><span className="spinner" /></div>
  if (error)   return <div className="alert alert-error">{error}</div>
  if (!ticket) return null

  const allowedTransitions = STATUS_TRANSITIONS[ticket.status] ?? []
  const isClosed           = ticket.status === 'closed'

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link
          to={ticket.status === 'open' ? '/queue' : '/backlog'}
          style={{ color: 'var(--color-muted)', fontSize: 13 }}
        >
          {ticket.status === 'open' ? '← Back to Queue' : '← Back to Backlog'}
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>

        {/* ---- Main column ---- */}
        <div>
          {/* Header */}
          <div className="ticket-detail-header">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {editingTitle ? (
                <form
                  style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}
                  onSubmit={async e => {
                    e.preventDefault()
                    if (!titleDraft.trim()) return
                    setSavingTitle(true)
                    try {
                      const u = await api.updateTicket(id, { subject: titleDraft.trim() })
                      setTicket(u)
                      setEditingTitle(false)
                    } catch (err) { alert(err.message) }
                    finally { setSavingTitle(false) }
                  }}
                >
                  <input
                    type="text"
                    className="form-control"
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    maxLength={500}
                    autoFocus
                    style={{ fontSize: 18, fontWeight: 700, flex: 1 }}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={savingTitle}>
                    {savingTitle ? <span className="spinner" /> : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditingTitle(false)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>{ticket.subject}</h1>
                  {['super_admin', 'supervisor'].includes(user.role) && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 2, flexShrink: 0 }}
                      onClick={() => { setTitleDraft(ticket.subject); setEditingTitle(true) }}
                    >
                      Edit title
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="ticket-detail-meta">
              <span className="ticket-id">SR {ticket.id}</span>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <span>Tenant: <strong>{ticket.tenant_name ?? `#${ticket.tenant_id}`}</strong></span>
              <span>Opened {formatDate(ticket.created_at)}</span>
              <span>By: <strong>{ticket.created_by_name ?? `#${ticket.created_by_user_id}`}</strong></span>
            </div>

            {/* SLA */}
            {(ticket.first_response_due_at || ticket.resolution_due_at) && !isClosed && (
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 4 }}>
                <SlaIndicator
                  label="First response"
                  createdAt={ticket.created_at}
                  dueAt={ticket.first_response_due_at}
                  metAt={ticket.first_response_met_at}
                />
                <SlaIndicator
                  label="Resolution"
                  createdAt={ticket.created_at}
                  dueAt={ticket.resolution_due_at}
                  metAt={['resolved','closed'].includes(ticket.status) ? ticket.updated_at : null}
                />
              </div>
            )}
          </div>

          {/* Thread */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-body">
              {messages.length === 0 ? (
                <p style={{ color: 'var(--color-muted)' }}>No messages yet.</p>
              ) : (
                <>
                  {messages.filter(m => m.source !== 'system').length > 0 && (
                    <div style={{ textAlign: 'right', marginBottom: 8 }}>
                      {collapsedIds.size > 0 ? (
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                                   fontSize: 12, color: 'var(--color-primary)', padding: 0 }}
                          onClick={expandAll}
                        >
                          Expand all
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                                   fontSize: 12, color: 'var(--color-primary)', padding: 0 }}
                          onClick={collapseAll}
                        >
                          Collapse all
                        </button>
                      )}
                    </div>
                  )}
                <div className="messages-thread">
                  {messages.map(msg => {
                    if (msg.source === 'system') {
                      const body = msg.body.replace(/^Status changed:\s*/i, '')
                      return (
                        <div key={msg.id} className="message-event">
                          <span className="message-event-text">
                            <strong>{body}</strong> · {formatDate(msg.created_at)}
                          </span>
                        </div>
                      )
                    }
                    const msgAtts = attachments.filter(a => a.message_id === msg.id)
                    return (
                      <div key={msg.id}>
                        <MessageItem
                          msg={msg}
                          currentUserId={user.id}
                          collapsed={collapsedIds.has(msg.id)}
                          onToggle={() => toggleMessage(msg.id)}
                        />
                        {!collapsedIds.has(msg.id) && msgAtts.length > 0 && (
                          <div style={{ paddingLeft: 48, marginTop: -8 }}>
                            <div className="attachments-list">
                              {msgAtts.map(a => (
                                <a
                                  key={a.id}
                                  href={api.downloadAttachment(a.id)}
                                  className="attachment-chip"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  📄 {a.original_filename}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                </>
              )}
            </div>
          </div>

          {/* Reply box */}
          {!isClosed && (
            <div className="reply-box">
              {/* Toggle: reply vs internal note */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 6, overflow: 'hidden',
                            border: '1px solid var(--color-border)', width: 'fit-content' }}>
                <button
                  type="button"
                  style={{
                    padding: '6px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                    background: !isInternal ? 'var(--color-primary)' : 'var(--color-surface)',
                    color:      !isInternal ? '#fff' : 'var(--color-muted)',
                  }}
                  onClick={() => setIsInternal(false)}
                >
                  Reply to customer
                </button>
                <button
                  type="button"
                  style={{
                    padding: '6px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                    background: isInternal ? '#d97706' : 'var(--color-surface)',
                    color:      isInternal ? '#fff' : 'var(--color-muted)',
                  }}
                  onClick={() => setIsInternal(true)}
                >
                  Internal note
                </button>
              </div>

              {isInternal && (
                <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                  Internal note — not visible to customer.
                </div>
              )}

              {replyError && <div className="alert alert-error">{replyError}</div>}

              <form onSubmit={handleReply}>
                <textarea
                  className="form-control"
                  rows={5}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={isInternal ? 'Write internal note…' : 'Write reply to customer…'}
                  style={{
                    marginBottom: 12,
                    borderColor: isInternal ? '#d97706' : undefined,
                  }}
                />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    className="btn"
                    style={{
                      background: isInternal ? '#d97706' : 'var(--color-primary)',
                      color: '#fff',
                      borderColor: isInternal ? '#d97706' : 'var(--color-primary)',
                    }}
                    disabled={sending || !replyBody.trim()}
                  >
                    {sending
                      ? <><span className="spinner" /> Sending…</>
                      : isInternal ? 'Add Note' : 'Send Reply'}
                  </button>

                  <label className="file-input-label">
                    <span>📎 Attach files</span>
                    <input type="file" multiple ref={fileRef} onChange={handleReplyFiles} />
                  </label>
                </div>

                {replyFiles.length > 0 && (
                  <div className="attachments-list" style={{ marginTop: 10 }}>
                    {replyFiles.map(f => (
                      <span key={f.name} className="attachment-chip">
                        📄 {f.name}
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                                   color: 'var(--color-muted)', fontSize: 12, padding: 0 }}
                          onClick={() => setReplyFiles(p => p.filter(x => x.name !== f.name))}
                        >✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

        {/* ---- Sidebar ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Ticket actions */}
          <div className="card">
            <div className="card-body" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Ticket Settings</div>

              {metaError   && <div className="alert alert-error"   style={{ padding: '8px 12px', fontSize: 12 }}>{metaError}</div>}
              {metaSuccess && <div className="alert alert-success" style={{ padding: '8px 12px', fontSize: 12 }}>{metaSuccess}</div>}

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Status</label>
                <select
                  className="form-control"
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  disabled={isClosed}
                >
                  {/* Current status always selectable */}
                  <option value={ticket.status}>{STATUS_LABELS[ticket.status]}</option>
                  {allowedTransitions.map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Priority</label>
                <select
                  className="form-control"
                  value={editPriority}
                  onChange={e => setEditPriority(e.target.value)}
                  disabled={isClosed}
                >
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Assigned to</label>
                <select
                  className="form-control"
                  value={editAssignee}
                  onChange={e => setEditAssignee(e.target.value)}
                  disabled={isClosed}
                >
                  <option value="">— Unassigned —</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>

              {!isClosed && (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={saveMeta}
                  disabled={savingMeta}
                >
                  {savingMeta ? <span className="spinner" /> : 'Save Changes'}
                </button>
              )}
            </div>
          </div>

          {/* Quick actions */}
          {!isClosed && (
            <div className="card">
              <div className="card-body" style={{ padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Quick Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ticket.assigned_to_user_id !== user.id && (
                    <button
                      className="btn btn-secondary"
                      style={{ justifyContent: 'center' }}
                      onClick={async () => {
                        try {
                          await api.updateTicket(id, {
                            assigned_to_user_id: user.id,
                            status: 'ce_pending',
                          })
                          await loadTicket()
                        } catch (err) { alert(err.message) }
                      }}
                    >
                      Claim ticket
                    </button>
                  )}
                  {allowedTransitions.includes('resolved') && (
                    <button
                      className="btn"
                      style={{ background: 'var(--color-success)', color: '#fff',
                               borderColor: 'var(--color-success)', justifyContent: 'center' }}
                      onClick={async () => {
                        try {
                          await api.updateTicket(id, { status: 'resolved' })
                          await loadTicket()
                        } catch (err) { alert(err.message) }
                      }}
                    >
                      Mark Resolved
                    </button>
                  )}
                  {allowedTransitions.includes('closed') && (
                    <button
                      className="btn btn-secondary"
                      style={{ justifyContent: 'center' }}
                      onClick={async () => {
                        if (!window.confirm('Close this ticket?')) return
                        try {
                          await api.updateTicket(id, { status: 'closed' })
                          await loadTicket()
                        } catch (err) { alert(err.message) }
                      }}
                    >
                      Close ticket
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Danger zone */}
          {user.role === 'super_admin' && (
            <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
              <div className="card-body" style={{ padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-danger)', marginBottom: 10 }}>
                  Danger Zone
                </div>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--color-danger)', color: '#fff',
                           borderColor: 'var(--color-danger)', width: '100%', justifyContent: 'center' }}
                  disabled={deleting}
                  onClick={async () => {
                    if (!window.confirm(`Permanently delete ticket #${ticket.id}? This cannot be undone.`)) return
                    setDeleting(true)
                    try {
                      await api.deleteTicket(id)
                      navigate('/queue')
                    } catch (err) {
                      alert(err.message)
                      setDeleting(false)
                    }
                  }}
                >
                  {deleting ? <span className="spinner" /> : 'Delete Ticket'}
                </button>
              </div>
            </div>
          )}

          {/* Ticket info */}
          <div className="card">
            <div className="card-body" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Details</div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    ['Ticket #',   `SR ${ticket.id}`],
                    ['Tenant',     ticket.tenant_name ?? `#${ticket.tenant_id}`],
                    ['Requester',  ticket.created_by_name],
                    ['Source',     ticket.source],
                    ['Created',    formatDate(ticket.created_at)],
                    ['Updated',    formatDate(ticket.updated_at)],
                    ['Resolved',   ticket.resolved_at ? formatDate(ticket.resolved_at) : '—'],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ color: 'var(--color-muted)', paddingBottom: 8, paddingRight: 8,
                                   verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        {label}
                      </td>
                      <td style={{ paddingBottom: 8, fontWeight: 500 }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* All ticket attachments */}
          {attachments.length > 0 && (
            <div className="card">
              <div className="card-body" style={{ padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
                  Attachments ({attachments.length})
                </div>
                <div className="attachments-list">
                  {attachments.map(a => (
                    <a
                      key={a.id}
                      href={api.downloadAttachment(a.id)}
                      className="attachment-chip"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      📄 {a.original_filename}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
