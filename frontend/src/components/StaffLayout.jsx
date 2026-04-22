import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const isAdmin = ['super_admin', 'supervisor'].includes(user?.role)

  return (
    <>
      <nav className="navbar">
        <Link to="/queue" className="navbar-brand">Support — Staff</Link>

        <NavLink
          to="/queue"
          className={({ isActive }) => 'navbar-link' + (isActive ? ' navbar-link-active' : '')}
        >
          Queue
        </NavLink>

        <NavLink
          to="/backlog"
          className={({ isActive }) => 'navbar-link' + (isActive ? ' navbar-link-active' : '')}
        >
          Backlog
        </NavLink>

        <NavLink
          to="/search"
          className={({ isActive }) => 'navbar-link' + (isActive ? ' navbar-link-active' : '')}
        >
          Search
        </NavLink>

        {isAdmin && (
          <>
            <NavLink
              to="/tenants"
              className={({ isActive }) => 'navbar-link' + (isActive ? ' navbar-link-active' : '')}
            >
              Tenants
            </NavLink>
            <NavLink
              to="/users"
              className={({ isActive }) => 'navbar-link' + (isActive ? ' navbar-link-active' : '')}
            >
              Users
            </NavLink>
          </>
        )}

        <span style={{ flex: 1 }} />
        <NotificationBell />

        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          {user?.full_name}
          <span
            style={{
              marginLeft: 6,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '1px 6px',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {user?.role?.replace('_', ' ')}
          </span>
        </span>

        <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
          Sign out
        </button>
      </nav>

      <main className="main-content" style={{ maxWidth: 1200 }}>
        <Outlet />
      </main>
    </>
  )
}
