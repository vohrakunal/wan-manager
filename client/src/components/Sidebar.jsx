import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const NAV = [
  { path: '/dashboard',   label: 'Dashboard',       icon: '📡' },
  { path: '/failover',    label: 'WAN Control',      icon: '⚡' },
  { path: '/routing',     label: 'Routing Tables',   icon: '🔀' },
  { path: '/dhcp',        label: 'DHCP Leases',      icon: '🖥️' },
  { path: '/clients',     label: 'Network Clients',  icon: '📊' },
  { path: '/logs',        label: 'Live Logs',        icon: '📜' },
  { path: '/health',      label: 'Health Check',     icon: '🩺' },
  { path: '/diagnostics', label: 'Diagnostics',      icon: '🔬' },
  { path: '/services',    label: 'Services',         icon: '⚙️' },
  { path: '/files',       label: 'File Manager',     icon: '🗂️' },
  { path: '/terminal',    label: 'Terminal',         icon: '⌨️' },
];

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <aside className={`sidebar${isOpen ? ' open' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-icon">🌐</span>
        <div>
          <div className="sidebar-brand-name">WAN Manager</div>
          <div className="sidebar-brand-sub">Dual-WAN Router</div>
        </div>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">✕</button>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button onClick={logout} className="sidebar-logout-btn">
          <span>⬡</span> Logout
        </button>
      </div>
    </aside>
  );
}
