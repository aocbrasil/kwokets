import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import StatusBadge   from '../../components/StatusBadge'
import PriorityBadge from '../../components/PriorityBadge'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SearchPage() {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState(null)   // null = no search yet
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (query.trim().length < 2) {
      setResults(null)
      setError('')
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await api.searchTickets(query.trim())
        setResults(data.results)
      } catch (err) {
        setError(err.message)
        setResults(null)
      } finally {
        setLoading(false)
      }
    }, 350)

    return () => clearTimeout(debounceRef.current)
  }, [query])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Search</h1>
      </div>

      {/* Search input */}
      <div style={{ marginBottom: 24 }}>
        <input
          type="search"
          className="form-control"
          placeholder="Search tickets and messages… (min 2 characters)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          style={{ fontSize: 16, padding: '10px 14px', maxWidth: 600 }}
        />
        {query.trim().length >= 2 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-muted)' }}>
            {loading
              ? 'Searching…'
              : results !== null
                ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${query.trim()}"`
                : ''}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Empty state before search */}
      {results === null && !loading && (
        <div className="empty-state">
          <h3>Find similar issues</h3>
          <p>Search across ticket subjects and message content — including resolved and closed tickets.</p>
        </div>
      )}

      {/* No results */}
      {results !== null && results.length === 0 && !loading && (
        <div className="empty-state">
          <h3>No results</h3>
          <p>Try different keywords or check spelling.</p>
        </div>
      )}

      {/* Results */}
      {results !== null && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {results.map(r => (
            <div key={r.id} className="card">
              <div className="card-body" style={{ padding: '16px 20px' }}>
                {/* Header row */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
                  <Link to={`/queue/${r.id}`} className="ticket-id" style={{ fontSize: 13 }}>
                    SR {r.id}
                  </Link>
                  <Link
                    to={`/queue/${r.id}`}
                    style={{ fontWeight: 600, fontSize: 15, flex: 1, minWidth: 0,
                             color: 'var(--color-text)', textDecoration: 'none' }}
                  >
                    {r.subject}
                  </Link>
                  <StatusBadge status={r.status} />
                  <PriorityBadge priority={r.priority} />
                </div>

                {/* Snippet */}
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-muted)',
                    background: '#f8fafc',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: '8px 12px',
                    marginBottom: 10,
                    lineHeight: 1.6,
                  }}
                  dangerouslySetInnerHTML={{ __html: r.snippet || '' }}
                />

                {/* Meta row */}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-muted)', flexWrap: 'wrap' }}>
                  <span>Tenant: <strong style={{ color: 'var(--color-text)' }}>{r.tenant_name}</strong></span>
                  {r.assigned_to_name && (
                    <span>Assigned: <strong style={{ color: 'var(--color-text)' }}>{r.assigned_to_name}</strong></span>
                  )}
                  <span>Updated: {formatDate(r.updated_at)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                    Match in {r.match_source === 'subject' ? 'subject' : 'message'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global <mark> highlight style */}
      <style>{`
        mark {
          background: #fef08a;
          color: inherit;
          border-radius: 2px;
          padding: 0 1px;
        }
      `}</style>
    </>
  )
}
