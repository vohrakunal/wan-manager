import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast.jsx';

const ACTION_LABEL = { start: 'Start', stop: 'Stop', restart: 'Restart' };

// Friendly display names / descriptions for known services
const META = {
  nginx:          { label: 'Nginx',          desc: 'Web / reverse-proxy server' },
  'isc-dhcp-server': { label: 'DHCP Server', desc: 'ISC DHCP lease manager' },
  openvpn:        { label: 'OpenVPN',         desc: 'VPN tunnel daemon' },
  iperf3:         { label: 'iPerf3',          desc: 'Network throughput test server' },
  docker:         { label: 'Docker',          desc: 'Container runtime' },
  fail2ban:       { label: 'Fail2Ban',        desc: 'Intrusion prevention' },
  lldpd:          { label: 'LLDPD',           desc: 'Link Layer Discovery Protocol' },
  nmbd:           { label: 'Samba NMB',       desc: 'NetBIOS name service' },
  smbd:           { label: 'Samba SMB',       desc: 'File sharing (SMB/CIFS)' },
  unbound:        { label: 'Unbound',         desc: 'Local DNS resolver' },
  vnstat:         { label: 'vnStat',          desc: 'Network traffic monitor' },
  sysstat:        { label: 'sysstat',         desc: 'System statistics collector' },
  cups:           { label: 'CUPS',            desc: 'Printing system' },
  bluetooth:      { label: 'Bluetooth',       desc: 'Bluetooth stack' },
  rsync:          { label: 'rsync',           desc: 'Remote file sync daemon' },
  saned:          { label: 'SANE',            desc: 'Scanner access daemon' },
  sssd:           { label: 'SSSD',            desc: 'System security services' },
  'speech-dispatcher': { label: 'Speech Dispatcher', desc: 'Text-to-speech middleware' },
};

function StatusBadge({ active }) {
  if (active === 'active')   return <span className="badge badge-green"><span className="dot dot-green" /> Running</span>;
  if (active === 'failed')   return <span className="badge badge-red"><span className="dot dot-red" /> Failed</span>;
  if (active === 'inactive') return <span className="badge badge-gray">Stopped</span>;
  return <span className="badge badge-gray">{active}</span>;
}

export default function Services() {
  const [services, setServices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState({}); // name → action
  const [filter, setFilter]     = useState('all');
  const showToast = useToast();
  const toast = {
    success: msg => showToast(msg, 'success'),
    error:   msg => showToast(msg, 'error'),
  };

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/services', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setServices(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function doAction(name, action) {
    setBusy(b => ({ ...b, [name]: action }));
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/services/${encodeURIComponent(name)}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.success) {
        toast.success(`${META[name]?.label || name} ${action}ed`);
        // Update that row immediately from the response
        if (data.status) {
          setServices(prev => prev.map(s => s.name === name ? data.status : s));
        }
      } else {
        toast.error(data.error || `${action} failed`);
      }
    } catch (err) {
      toast.error(String(err));
    }
    setBusy(b => { const n = { ...b }; delete n[name]; return n; });
  }

  const filtered = services.filter(s => {
    if (filter === 'running')  return s.active === 'active';
    if (filter === 'stopped')  return s.active === 'inactive';
    if (filter === 'failed')   return s.active === 'failed';
    return true;
  });

  const counts = {
    running: services.filter(s => s.active === 'active').length,
    stopped: services.filter(s => s.active === 'inactive').length,
    failed:  services.filter(s => s.active === 'failed').length,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Services</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            Manage system services — critical services are excluded
          </div>
        </div>
        <button className="btn-secondary" onClick={load} style={{ fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid-3" style={{ marginBottom: 20, gap: 12 }}>
        {[
          { key: 'all',     label: 'Total',   count: services.length, color: 'var(--accent)' },
          { key: 'running', label: 'Running', count: counts.running,  color: 'var(--green)' },
          { key: 'stopped', label: 'Stopped', count: counts.stopped,  color: 'var(--text2)' },
        ].map(({ key, label, count, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              background: filter === key ? 'var(--bg3)' : 'var(--bg2)',
              border: `1px solid ${filter === key ? color : 'var(--border)'}`,
              borderRadius: 8, padding: '14px 18px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{label}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'monospace' }}>{count}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /> Loading services…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Enabled</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text2)', padding: 28 }}>
                      No services match
                    </td>
                  </tr>
                ) : filtered.map(svc => {
                  const meta = META[svc.name] || {};
                  const isBusy = !!busy[svc.name];
                  const isRunning = svc.active === 'active';

                  return (
                    <tr key={svc.name}>
                      <td>
                        <code style={{ color: 'var(--text)', fontSize: 13 }}>
                          {meta.label || svc.name}
                        </code>
                        <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'monospace', marginTop: 1 }}>
                          {svc.name}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                        {meta.desc || '—'}
                      </td>
                      <td>
                        <StatusBadge active={svc.active} />
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {svc.enabled}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {/* Start — only when stopped */}
                          {!isRunning && (
                            <button
                              className="btn-success"
                              style={{ fontSize: 11, padding: '4px 12px' }}
                              disabled={isBusy}
                              onClick={() => doAction(svc.name, 'start')}
                            >
                              {busy[svc.name] === 'start' ? '…' : 'Start'}
                            </button>
                          )}
                          {/* Restart — only when running */}
                          {isRunning && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '4px 12px' }}
                              disabled={isBusy}
                              onClick={() => doAction(svc.name, 'restart')}
                            >
                              {busy[svc.name] === 'restart' ? '…' : 'Restart'}
                            </button>
                          )}
                          {/* Stop — only when running */}
                          {isRunning && (
                            <button
                              className="btn-danger"
                              style={{ fontSize: 11, padding: '4px 12px' }}
                              disabled={isBusy}
                              onClick={() => doAction(svc.name, 'stop')}
                            >
                              {busy[svc.name] === 'stop' ? '…' : 'Stop'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
