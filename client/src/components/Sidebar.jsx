import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const NAV = [
  { path: '/dashboard',   label: 'Dashboard',       icon: '📡' },
  { path: '/failover',    label: 'WAN Control',      icon: '⚡' },
  { path: '/routing',     label: 'Routing Tables',   icon: '🔀' },
  { path: '/dhcp',        label: 'DHCP Leases',      icon: '🖥️' },
  { path: '/logs',        label: 'Live Logs',        icon: '📜' },
  { path: '/diagnostics', label: 'Diagnostics',      icon: '🔬' },
  { path: '/services',    label: 'Services',         icon: '⚙️' },
  { path: '/terminal',    label: 'Terminal',         icon: '⌨️' },
];

export default function Sidebar() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        <span style={styles.brandIcon}>🌐</span>
        <div>
          <div style={styles.brandName}>WAN Manager</div>
          <div style={styles.brandSub}>Dual-WAN Router</div>
        </div>
      </div>

      <nav style={styles.nav}>
        {NAV.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}
          >
            <span style={styles.linkIcon}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={styles.footer}>
        <button onClick={logout} style={styles.logoutBtn}>
          <span>⬡</span> Logout
        </button>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 'var(--sidebar-w)',
    minWidth: 'var(--sidebar-w)',
    background: 'var(--bg2)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '20px 16px 16px',
    borderBottom: '1px solid var(--border)',
  },
  brandIcon: { fontSize: 24 },
  brandName: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  brandSub:  { fontSize: 11, color: 'var(--text2)' },
  nav: { flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 },
  link: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 10px', borderRadius: 6,
    color: 'var(--text2)', fontSize: 13, fontWeight: 500,
    transition: 'background 0.12s, color 0.12s',
  },
  linkActive: {
    background: 'rgba(47,129,247,0.15)',
    color: 'var(--accent2)',
  },
  linkIcon: { fontSize: 16, width: 20, textAlign: 'center' },
  footer: {
    padding: '12px 8px',
    borderTop: '1px solid var(--border)',
  },
  logoutBtn: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 10px', borderRadius: 6,
    background: 'transparent', color: 'var(--text2)', fontSize: 13,
    transition: 'background 0.12s, color 0.12s',
  },
};
