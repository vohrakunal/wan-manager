import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Failover from './pages/Failover.jsx';
import RoutingTables from './pages/RoutingTables.jsx';
import DhcpLeases from './pages/DhcpLeases.jsx';
import LiveLogs from './pages/LiveLogs.jsx';
import Diagnostics from './pages/Diagnostics.jsx';
import Terminal from './pages/Terminal.jsx';
import Services from './pages/Services.jsx';
import Login from './pages/Login.jsx';
import { ToastProvider } from './components/Toast.jsx';
import './App.css';

function ProtectedLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/"            element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"   element={<Dashboard />} />
          <Route path="/failover"    element={<Failover />} />
          <Route path="/routing"     element={<RoutingTables />} />
          <Route path="/dhcp"        element={<DhcpLeases />} />
          <Route path="/logs"        element={<LiveLogs />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/terminal"    element={<Terminal />} />
          <Route path="/services"    element={<Services />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  useEffect(() => {
    const handler = () => setToken(localStorage.getItem('token'));
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={
            token
              ? <Navigate to="/dashboard" replace />
              : <Login onLogin={t => { localStorage.setItem('token', t); setToken(t); }} />
          } />
          <Route path="/*" element={
            token ? <ProtectedLayout /> : <Navigate to="/login" replace />
          } />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
