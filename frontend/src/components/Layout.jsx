import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import NotificationBell from './NotificationBell'

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <>
      <nav className="navbar">
        <Link to="/tickets" className="navbar-brand">Support Portal</Link>
        <NotificationBell />
        <Link to="/tickets" className="navbar-link">My Tickets</Link>
        <span className="navbar-link" style={{ color: 'var(--color-muted)', fontSize: 13 }}>
          {user?.full_name}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleLogout}
        >
          Sign out
        </button>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </>
  )
}
