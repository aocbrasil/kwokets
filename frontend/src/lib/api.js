const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(method, path, body, options = {}) {
  const token = getToken()

  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body && !(body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body instanceof FormData
      ? body
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
    ...options,
  })

  if (res.status === 204) return null

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.errors = data?.errors || []
    throw err
  }

  return data
}

export const api = {
  // Auth
  login:  (email, password)  => request('POST', '/auth/login',  { email, password }),
  logout: ()                  => request('POST', '/auth/logout'),
  me:     ()                  => request('GET',  '/auth/me'),

  // Tenants
  listTenants:    ()        => request('GET',   '/tenants'),
  createTenant:   (data)    => request('POST',  '/tenants', data),
  updateTenant:   (id, data)=> request('PATCH',  `/tenants/${id}`, data),
  deleteTenant:   (id)      => request('DELETE', `/tenants/${id}`),
  listSlaRules:   (tenantId)=> request('GET',   `/tenants/${tenantId}/sla-rules`),
  upsertSlaRule:  (tenantId, data) => request('POST', `/tenants/${tenantId}/sla-rules`, data),

  // Users
  listUsers:   (params = {}) => request('GET',   '/users?' + new URLSearchParams(params)),
  createUser:  (data)        => request('POST',  '/users', data),
  getUser:     (id)          => request('GET',   `/users/${id}`),
  updateUser:  (id, data)    => request('PATCH', `/users/${id}`, data),

  // Tickets
  listTickets:   (params = {}) => request('GET', '/tickets?' + new URLSearchParams(params)),
  getTicket:     (id)          => request('GET', `/tickets/${id}`),
  createTicket:  (data)        => request('POST', '/tickets', data),
  updateTicket:  (id, data)    => request('PATCH',  `/tickets/${id}`, data),
  deleteTicket:  (id)          => request('DELETE', `/tickets/${id}`),

  // Messages
  listMessages:  (ticketId)    => request('GET',  `/tickets/${ticketId}/messages`),
  createMessage: (ticketId, data) => request('POST', `/tickets/${ticketId}/messages`, data),

  // Attachments
  listAttachments: (ticketId) => request('GET', `/tickets/${ticketId}/attachments`),
  uploadAttachment: (ticketId, file, messageId) => {
    const form = new FormData()
    form.append('file', file)
    if (messageId) form.append('message_id', messageId)
    return request('POST', `/tickets/${ticketId}/attachments`, form)
  },
  downloadAttachment: (attachmentId) => {
    const token = getToken()
    return `${BASE}/attachments/${attachmentId}${token ? '?token=' + encodeURIComponent(token) : ''}`
  },

  // Search
  searchTickets: (q, limit = 30) =>
    request('GET', '/search?' + new URLSearchParams({ q, limit })),

  // Notifications
  listNotifications: (unread = false) =>
    request('GET', '/notifications' + (unread ? '?unread=1' : '')),
  markNotificationRead:    (id) => request('PATCH', `/notifications/${id}/read`),
  markAllNotificationsRead: ()  => request('PATCH', '/notifications/read-all'),
}
