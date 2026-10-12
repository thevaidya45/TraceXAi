import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Navbar from './Navbar.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function AppShell({ items, active, title, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  const roleLabel = user ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-nav">
        <div className="app-nav-inner">
          <Link to="/" className="brand-mark">
            TraceX AI
          </Link>
          <div className="app-nav-desktop">
            <Navbar items={items} active={active} />
          </div>
          <div className="app-nav-right">
            {user ? <NotificationBell /> : null}
            {user ? (
              <Link to="/account" className={`profile-link${active === 'Profile' ? ' is-active' : ''}`}>
                <span className="account-name">{user.name}</span>
                <span className="account-role">{roleLabel}</span>
              </Link>
            ) : null}
            <button type="button" className="btn btn-ghost btn-small" onClick={handleLogout}>
              Logout
            </button>
            <button
              type="button"
              className="nav-menu-btn"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div className="app-nav-mobile" id="mobile-nav">
            <Navbar
              items={[...items, { label: 'Account', to: '/account' }]}
              active={active}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        ) : null}
      </header>
      <main className="app-body" id="main">
        <div className="page-header">
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="page-content fade-in">{children}</div>
      </main>
    </div>
  );
}
