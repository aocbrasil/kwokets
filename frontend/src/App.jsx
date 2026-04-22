import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'

import LoginPage        from './pages/LoginPage'
import MyTicketsPage    from './pages/MyTicketsPage'
import CreateTicketPage from './pages/CreateTicketPage'
import TicketDetailPage from './pages/TicketDetailPage'
import Layout           from './components/Layout'

import StaffLayout             from './components/StaffLayout'
import QueuePage               from './pages/staff/QueuePage'
import BacklogPage             from './pages/staff/BacklogPage'
import TicketDetailStaffPage   from './pages/staff/TicketDetailStaffPage'
import CreateTicketStaffPage   from './pages/staff/CreateTicketStaffPage'
import TenantsPage             from './pages/staff/TenantsPage'
import UsersPage               from './pages/staff/UsersPage'
import SearchPage              from './pages/staff/SearchPage'

const STAFF_ROLES = ['agent', 'supervisor', 'super_admin']

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Loading…</div>
  if (!user)   return <Navigate to="/login" replace />
  return children
}

function DefaultRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return STAFF_ROLES.includes(user.role)
    ? <Navigate to="/queue" replace />
    : <Navigate to="/tickets" replace />
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Loading…</div>

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user
            ? (STAFF_ROLES.includes(user.role)
                ? <Navigate to="/queue" replace />
                : <Navigate to="/tickets" replace />)
            : <LoginPage />
        }
      />

      {/* Customer portal */}
      <Route
        path="/"
        element={<RequireAuth><Layout /></RequireAuth>}
      >
        <Route path="tickets"     element={<MyTicketsPage />} />
        <Route path="tickets/new" element={<CreateTicketPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
      </Route>

      {/* Staff portal */}
      <Route
        path="/"
        element={<RequireAuth><StaffLayout /></RequireAuth>}
      >
        <Route path="queue"             element={<QueuePage />} />
        <Route path="queue/new"         element={<CreateTicketStaffPage />} />
        <Route path="queue/:id"         element={<TicketDetailStaffPage />} />
        <Route path="backlog"           element={<BacklogPage />} />
        <Route path="search"            element={<SearchPage />} />
        <Route path="tenants"           element={<TenantsPage />} />
        <Route path="users"             element={<UsersPage />} />
      </Route>

      <Route index element={<DefaultRedirect />} />
      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  )
}
