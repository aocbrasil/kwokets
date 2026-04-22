import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api }     from '../lib/api'
import StatusBadge   from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import SlaIndicator  from '../components/SlaIndicator'

const MAX_FILE_BYTES = 100 * 1024 * 1024

function formatDate(iso) {
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
      <div className={`message-avatar ${isSelf ? 'avatar-self' : isStaff ? 'avatar-staff' : ''}`}>
        {initials(msg.user_name)}
      </div>
      <div className="message-bubble">
        <div
          className="message-meta"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={onToggle}
        >
          <strong>{msg.user_name}</strong>
          {isInternal && <span className="internal-tag">Internal note</span>}
          {msg.source === 'email' && (
            <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>via email</span>
          )}
          <span>{formatDate(msg.created_at)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-muted)' }}>
            {collapsed ? '▶' : '▼'}
          </span>
        </div>
        {!collapsed && <div className="message-body">{msg.body}</div>}
      </div>
    </div>
  )
}

export default function TicketDetailPage() {
  const { id }     = useParams()
  const { user }   = useAuth()
  const fileRef    = useRef(null)

  const [ticket,   setTicket]   = useState(null)
  const [messages, setMessages] = useState([])
  const [attachments, setAttachments] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  const [replyBody,  setReplyBody]  = useState('')
  const [replyFiles, setReplyFiles] = useState([])
  const [sending,    setSending]    = useState(false)
  const [replyError, setReplyError] = useState('')

  const [reopening,       setReopening]       = useState(false)
  const [showCloseForm,   setShowCloseForm]   = useState(false)
  const [closureReason,   setClosureReason]   = useState('')
  const [requestingClose, setRequestingClose] = useState(false)
  const [closeError,      setCloseError]      = useState('')

  const [showPriorityForm,    setShowPriorityForm]    = useState(false)
  const [newPriority,         setNewPriority]         = useState('')
  const [priorityJustification, setPriorityJustification] = useState('')
  const [escalating,          setEscalating]          = useState(false)
  const [escalateError,       setEscalateError]       = useState('')

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
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadTicket() }, [loadTicket])

  // ---- Reply ----
  function handleReplyFiles(e) {
    const chosen   = Array.from(e.target.files)
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
      const msg = await api.createMessage(id, { body: replyBody })

      // Upload files attached to this message
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

  async function handleReopen() {
    setReopening(true)
    try {
      await api.updateTicket(id, { status: 'open' })
      await loadTicket()
    } catch (err) {
      alert(err.message)
    } finally {
      setReopening(false)
    }
  }

  async function handleRequestClose(e) {
    e.preventDefault()
    setCloseError('')
    setRequestingClose(true)
    try {
      await api.updateTicket(id, {
        status: 'close_pending',
        closure_reason: closureReason,
      })
      setShowCloseForm(false)
      setClosureReason('')
      await loadTicket()
    } catch (err) {
      setCloseError(err.message)
    } finally {
      setRequestingClose(false)
    }
  }

  async function handleEscalatePriority(e) {
    e.preventDefault()
    if (!newPriority)                  return
    if (!priorityJustification.trim()) { setEscalateError('Justification is required'); return }
    setEscalateError('')
    setEscalating(true)
    try {
      await api.updateTicket(id, {
        priority:               newPriority,
        priority_justification: priorityJustification,
      })
      setShowPriorityForm(false)
      setNewPriority('')
      setPriorityJustification('')
      await loadTicket()
    } catch (err) {
      setEscalateError(err.message)
    } finally {
      setEscalating(false)
    }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <span className="spinner" />
    </div>
  )

  if (error) return <div className="alert alert-error">{error}</div>
  if (!ticket) return null

  const isClosed         = ticket.status === 'closed'
  const isClosePending   = ticket.status === 'close_pending'
  const isResolved       = ticket.status === 'resolved'
  const canReply         = !isClosed && !isClosePending
  const canRequestClose  = !isClosed && !isClosePending

  const canReopen = isClosed && ticket.closed_at &&
    (Date.now() - new Date(ticket.closed_at)) / 86400000 <= 14

  // Priorities the customer can escalate TO (must be higher than current)
  const priorityOrder    = { p1: 1, p2: 2, p3: 3, p4: 4 }
  const currentPriOrder  = priorityOrder[ticket.priority] ?? 99
  const escalatablePriorities = Object.entries(priorityOrder)
    .filter(([, order]) => order < currentPriOrder)
    .map(([key]) => key)
  const canEscalate = escalatablePriorities.length > 0 && !isClosed && !isClosePending

  return (
    <>
      {/* Back link */}
      <div style={{ marginBottom: 16 }}>
        <Link to="/tickets" style={{ color: 'var(--color-muted)', fontSize: 13 }}>
          ← Back to My Tickets
        </Link>
      </div>

      {/* Ticket header */}
      <div className="ticket-detail-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, flex: 1 }}>{ticket.subject}</h1>
        </div>

        <div className="ticket-detail-meta">
          <span className="ticket-id">SR {ticket.id}</span>
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <span>Opened {formatDate(ticket.created_at)}</span>
          {ticket.assigned_to_name && (
            <span>Assigned to <strong>{ticket.assigned_to_name}</strong></span>
          )}
        </div>

        {/* SLA indicators (visible to customer) */}
        {(ticket.first_response_due_at || ticket.resolution_due_at) && (
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
              metAt={ticket.status === 'resolved' || ticket.status === 'closed' ? ticket.updated_at : null}
            />
          </div>
        )}
      </div>

      {/* Resolved banner */}
      {isResolved && (
        <div className="alert alert-success" style={{ marginBottom: 20 }}>
          This ticket is resolved. You can still reply within 14 days to reopen it.
        </div>
      )}
      {isClosePending && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          Closure has been requested. Awaiting staff confirmation.
        </div>
      )}
      {isClosed && (
        <div className="alert" style={{
          background: '#f1f5f9', border: '1px solid var(--color-border)',
          marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>This ticket is closed.</span>
          {canReopen && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleReopen}
              disabled={reopening}
            >
              {reopening ? <span className="spinner" /> : 'Reopen Ticket'}
            </button>
          )}
        </div>
      )}
      {isClosed && !canReopen && ticket.closed_at && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 16 }}>
          Reopen window expired (14 days from closure).
        </div>
      )}

      {/* Customer action buttons */}
      {(canEscalate || canRequestClose) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {canEscalate && !showPriorityForm && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowPriorityForm(true)
                setShowCloseForm(false)
                setNewPriority(escalatablePriorities[0])
              }}
            >
              Escalate Priority
            </button>
          )}
          {canRequestClose && !showCloseForm && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowCloseForm(true)
                setShowPriorityForm(false)
              }}
            >
              Request Closure
            </button>
          )}
        </div>
      )}

      {/* Priority escalation form */}
      {showPriorityForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Escalate Priority</div>
            {escalateError && <div className="alert alert-error">{escalateError}</div>}
            <form onSubmit={handleEscalatePriority}>
              <div className="form-group">
                <label className="form-label">New Priority</label>
                <select
                  className="form-control"
                  style={{ width: 'auto' }}
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value)}
                >
                  {escalatablePriorities.map(p => (
                    <option key={p} value={p}>
                      {{ p1: 'P1 — Critical', p2: 'P2 — High', p3: 'P3 — Medium' }[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Justification <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={priorityJustification}
                  onChange={e => setPriorityJustification(e.target.value)}
                  placeholder="Explain why this ticket needs to be escalated…"
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={escalating}>
                  {escalating ? <span className="spinner" /> : 'Submit Escalation'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setShowPriorityForm(false); setEscalateError('') }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request closure form */}
      {showCloseForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Request ticket closure</div>
            {closeError && <div className="alert alert-error">{closeError}</div>}
            <form onSubmit={handleRequestClose}>
              <div className="form-group">
                <label className="form-label">
                  Reason <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={closureReason}
                  onChange={e => setClosureReason(e.target.value)}
                  placeholder="Describe why the ticket can be closed…"
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={requestingClose}>
                  {requestingClose ? <span className="spinner" /> : 'Confirm Request'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setShowCloseForm(false); setClosureReason(''); setCloseError('') }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Messages thread */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-body">
          {messages.length === 0 ? (
            <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>No messages yet.</p>
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
      {canReply && (
        <div className="reply-box">
          <h3>Reply</h3>
          {replyError && <div className="alert alert-error">{replyError}</div>}
          <form onSubmit={handleReply}>
            <textarea
              className="form-control"
              rows={5}
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder="Type your reply…"
              style={{ marginBottom: 12 }}
            />

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={sending || !replyBody.trim()}>
                {sending ? <><span className="spinner" /> Sending…</> : 'Send Reply'}
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
                      onClick={() => setReplyFiles(prev => prev.filter(x => x.name !== f.name))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </form>
        </div>
      )}
    </>
  )
}

