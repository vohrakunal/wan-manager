import React, { useState, useEffect, useCallback } from 'react';
import { getLanClients, getWanSessions } from '../api/index.js';
import { useToast } from '../components/Toast.jsx';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function BwBar({ value, max }) {
  if (!max || !value) return null;
  const pct = Math.min(100, Math.round((value / max) * 100));
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ──────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────
const TABS = [
  { key: 'lan',  label: 'LAN Bandwidth' },
  { key: 'wan',  label: 'Service Connections' },
];

// ──────────────────────────────────────────────
// LAN Clients section
// ──────────────────────────────────────────────
function LanSection({ toast }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await getLanClients();
      setData(d);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load LAN clients', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const clients = data?.clients || [];
  const filtered = filter
    ? clients.filter(c =>
        c.ip.includes(filter) ||
        (c.mac || '').includes(filter.toLowerCase()) ||
        (c.hostname || '').toLowerCase().includes(filter.toLowerCase()))
    : clients;

  const maxBytes = clients[0]?.totalBytes || 1; // first item is highest (sorted)

  return (
    <div>
      {/* Summary strip */}
      {data && (
        <div className="card section-gap" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Online Devices</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent2)' }}>{clients.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>LAN Interface</div>
              <div style={{ fontWeight: 600 }}><code>{data.lanIface}</code></div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Gateway IP</div>
              <div style={{ fontWeight: 600 }}><code>{data.lanIp}</code></div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Counters</div>
              <div>
                {data.countersActive
                  ? <span className="badge badge-green">Active</span>
                  : <span className="badge badge-yellow">Warming up…</span>}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                Updated {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Filter by IP, MAC, or hostname…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <button className="btn-secondary" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>↺ Refresh</button>
      </div>

      {/* No bandwidth data notice */}
      {data && !data.nfConntrackAvailable && (
        <div style={{
          background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.25)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--yellow)',
        }}>
          Bandwidth data unavailable — <code>/proc/net/nf_conntrack</code> is not readable. Device list and hostnames are still shown from ARP + DHCP leases.
        </div>
      )}
      {data && data.nfConntrackAvailable && !data.countersActive && (
        <div style={{
          background: 'rgba(47,129,247,0.06)', border: '1px solid rgba(47,129,247,0.2)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--accent2)',
        }}>
          Conntrack available — bytes will populate as devices make connections. Reload in a moment.
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? (
          <div className="loading-center"><span className="spinner" /> Loading devices…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>IP Address</th>
                  <th>MAC Address</th>
                  <th>Hostname</th>
                  <th>Upload (TX)</th>
                  <th>Download (RX)</th>
                  <th>Total</th>
                  <th>Usage</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text2)', padding: 32 }}>
                      {clients.length === 0 ? 'No LAN devices found in ARP table' : 'No devices match filter'}
                    </td>
                  </tr>
                ) : filtered.map((c, i) => (
                  <tr key={c.ip}>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{i + 1}</td>
                    <td><code style={{ color: 'var(--accent)' }}>{c.ip}</code></td>
                    <td><code style={{ fontSize: 11 }}>{c.mac}</code></td>
                    <td style={{ color: c.hostname ? 'var(--text)' : 'var(--text2)' }}>
                      {c.hostname || <span style={{ fontStyle: 'italic' }}>unknown</span>}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--yellow)' }}>{fmtBytes(c.txBytes)}</span>
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--accent2)' }}>{fmtBytes(c.rxBytes)}</span>
                    </td>
                    <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtBytes(c.totalBytes)}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <BwBar value={c.totalBytes} max={maxBytes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
            {clients.length} device{clients.length !== 1 ? 's' : ''} online · Cumulative bytes via iptables accounting · Auto-refreshes every 15s
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// WAN Sessions section
// ──────────────────────────────────────────────
// Service connections section
// ──────────────────────────────────────────────

const CATEGORY_COLOR = {
  remote:   { bg: 'rgba(47,129,247,0.12)',  text: '#2f81f7',  border: 'rgba(47,129,247,0.3)'  },
  web:      { bg: 'rgba(63,185,80,0.12)',   text: '#3fb950',  border: 'rgba(63,185,80,0.3)'   },
  database: { bg: 'rgba(240,136,62,0.12)',  text: '#f0883e',  border: 'rgba(240,136,62,0.3)'  },
};

function ServiceBadge({ name, category }) {
  const c = CATEGORY_COLOR[category] || { bg: 'var(--bg3)', text: 'var(--text2)', border: 'var(--border)' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>
      {name}
    </span>
  );
}

function WanSection({ toast }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await getWanSessions();
      setData(d);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load service connections', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const sessions = data?.sessions || [];
  const byService = data?.byService || {};

  let filtered = catFilter === 'all' ? sessions : sessions.filter(s => s.category === catFilter);
  if (filter) {
    const lc = filter.toLowerCase();
    filtered = filtered.filter(s =>
      s.remoteIp?.includes(lc) ||
      (s.hostname || '').toLowerCase().includes(lc) ||
      s.service?.toLowerCase().includes(lc) ||
      (s.process || '').toLowerCase().includes(lc)
    );
  }

  const categories = ['all', 'remote', 'web', 'database'];

  return (
    <div>
      {/* Service summary cards */}
      {data && Object.keys(byService).length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {Object.entries(byService).map(([svc, count]) => (
            <div key={svc} className="card" style={{ padding: '12px 20px', minWidth: 110, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent2)' }}>{count}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{svc}</div>
            </div>
          ))}
          <div className="card" style={{ padding: '12px 20px', minWidth: 110, textAlign: 'center', marginLeft: 'auto' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{sessions.length}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>Total</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Filter by IP, hostname, service, or process…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12,
                background: catFilter === c ? 'var(--accent)' : 'var(--bg3)',
                color:      catFilter === c ? '#fff' : 'var(--text2)',
                fontWeight: catFilter === c ? 600 : 400,
                transition: 'background 0.12s',
                textTransform: 'capitalize',
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
          ↺ Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading && !data ? (
          <div className="loading-center"><span className="spinner" /> Loading connections…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Port</th>
                  <th>Connected From (IP)</th>
                  <th>Origin</th>
                  <th>Process</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text2)', padding: 32 }}>
                      {sessions.length === 0
                        ? 'No active service connections found. SSH, FTP, Nginx, MongoDB connections will appear here.'
                        : 'No connections match filter'}
                    </td>
                  </tr>
                ) : filtered.map((s, i) => (
                  <tr key={i}>
                    <td><ServiceBadge name={s.service} category={s.category} /></td>
                    <td><code style={{ color: 'var(--text2)', fontSize: 12 }}>{s.localPort}</code></td>
                    <td>
                      <code style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>{s.remoteIp}</code>
                      <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 4 }}>:{s.remotePort}</span>
                      {s.hostname && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{s.hostname}</div>
                      )}
                    </td>
                    <td>
                      {s.isLan
                        ? <span className="badge badge-blue">LAN</span>
                        : <span className="badge badge-yellow">WAN</span>}
                    </td>
                    <td>
                      {s.process
                        ? <code style={{ fontSize: 11, color: 'var(--text2)' }}>{s.process}</code>
                        : <span style={{ color: 'var(--text2)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
            {sessions.length} active connection{sessions.length !== 1 ? 's' : ''} to local services · Auto-refreshes every 15s
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────
export default function NetworkClients() {
  const toast = useToast();
  const [tab, setTab] = useState('lan');

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Network Clients</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            LAN bandwidth usage · Service connection monitor
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 20px', background: 'transparent', fontSize: 13, fontWeight: 500,
              color: tab === t.key ? 'var(--text)' : 'var(--text2)',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {t.key === 'lan' ? '🖥️ ' : '🔌 '}{t.label}
          </button>
        ))}
      </div>

      {tab === 'lan' && <LanSection toast={toast} />}
      {tab === 'wan' && <WanSection toast={toast} />}
    </div>
  );
}
