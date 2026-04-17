import React, { useState, useEffect, useCallback } from 'react';
import { getLanClients, resetBwCounters, getWanSessions } from '../api/index.js';
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

function WanBadge({ wan }) {
  if (wan === 'ZTE')     return <span className="badge badge-blue">ZTE</span>;
  if (wan === 'DIGISOL') return <span className="badge" style={{ background: 'rgba(162,89,247,0.15)', color: '#a259f7', border: '1px solid rgba(162,89,247,0.3)' }}>DIGISOL</span>;
  return <span className="badge badge-gray">—</span>;
}

// ──────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────
const TABS = [
  { key: 'lan',  label: 'LAN Bandwidth' },
  { key: 'wan',  label: 'WAN Sessions' },
];

// ──────────────────────────────────────────────
// LAN Clients section
// ──────────────────────────────────────────────
function LanSection({ toast }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [resetting, setResetting] = useState(false);

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

  async function handleReset() {
    setResetting(true);
    try {
      await resetBwCounters();
      toast('Bandwidth counters reset', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error || 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  }

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
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                Updated {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Filter by IP, MAC, or hostname…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <button className="btn-secondary" onClick={load} disabled={loading}>↺ Refresh</button>
        <button
          className="btn-secondary"
          onClick={handleReset}
          disabled={resetting}
          title="Zero out iptables byte counters to start a fresh measurement"
          style={{ marginLeft: 'auto' }}
        >
          {resetting ? <span className="spinner" /> : '⟳ Reset Counters'}
        </button>
      </div>

      {/* Counter warming notice */}
      {data && !data.countersActive && (
        <div style={{
          background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.25)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--yellow)',
        }}>
          Bandwidth counters are initialising — iptables rules have been inserted. Traffic data will appear after the first packets are forwarded. Reload in a few seconds.
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
            {clients.length} device{clients.length !== 1 ? 's' : ''} online · Counters measure forwarded bytes since last reset · Auto-refreshes every 15s
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// WAN Sessions section
// ──────────────────────────────────────────────
function WanSection({ toast }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [wanFilter, setWanFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await getWanSessions();
      setData(d);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load WAN sessions', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const sessions = data?.sessions || [];

  let filtered = sessions;
  if (wanFilter !== 'all') filtered = filtered.filter(s => s.wan === wanFilter);
  if (filter) {
    const lc = filter.toLowerCase();
    filtered = filtered.filter(s =>
      s.srcIp?.includes(lc) ||
      s.dstIp?.includes(lc) ||
      (s.srcHostname || '').toLowerCase().includes(lc) ||
      (s.dstHostname || '').toLowerCase().includes(lc) ||
      String(s.dstPort)?.includes(lc)
    );
  }

  const zteCount     = sessions.filter(s => s.wan === 'ZTE').length;
  const digisolCount = sessions.filter(s => s.wan === 'DIGISOL').length;

  return (
    <div>
      {/* Summary strip */}
      {data && (
        <div className="card section-gap" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Sessions</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent2)' }}>{sessions.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Via ZTE</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>{zteCount}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Via DIGISOL</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#a259f7' }}>{digisolCount}</div>
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
          placeholder="Filter by IP, hostname, or port…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {/* WAN filter pills */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { key: 'all',     label: `All (${sessions.length})` },
            { key: 'ZTE',     label: `ZTE (${zteCount})` },
            { key: 'DIGISOL', label: `DIGISOL (${digisolCount})` },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setWanFilter(f.key)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12,
                background: wanFilter === f.key ? 'var(--accent)' : 'var(--bg3)',
                color:      wanFilter === f.key ? '#fff'         : 'var(--text2)',
                fontWeight: wanFilter === f.key ? 600 : 400,
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {f.label}
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
          <div className="loading-center"><span className="spinner" /> Loading sessions…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Proto</th>
                  <th>LAN Client</th>
                  <th>Remote Host</th>
                  <th>Port</th>
                  <th>Bytes</th>
                  <th>WAN</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text2)', padding: 32 }}>
                      {sessions.length === 0 ? 'No active WAN sessions found' : 'No sessions match filter'}
                    </td>
                  </tr>
                ) : filtered.map((s, i) => {
                  const isLanSrc = !isPublicIp(s.srcIp);
                  const lanIp    = isLanSrc ? s.srcIp  : s.dstIp;
                  const remoteIp = isLanSrc ? s.dstIp  : s.srcIp;
                  const lanHost  = isLanSrc ? s.srcHostname : s.dstHostname;
                  const remHost  = isLanSrc ? s.dstHostname : s.srcHostname;
                  const dstPort  = isLanSrc ? s.dstPort : s.srcPort;
                  return (
                    <tr key={i}>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                          background: 'var(--bg3)', color: 'var(--text2)',
                        }}>
                          {s.proto}
                        </span>
                      </td>
                      <td>
                        <div><code style={{ color: 'var(--accent)', fontSize: 12 }}>{lanIp}</code></div>
                        {lanHost && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{lanHost}</div>}
                      </td>
                      <td>
                        <div><code style={{ fontSize: 12 }}>{remoteIp}</code></div>
                        {remHost && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{remHost}</div>}
                      </td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                        {dstPort ? <code>{dstPort}{dstPort === 443 ? ' (HTTPS)' : dstPort === 80 ? ' (HTTP)' : dstPort === 53 ? ' (DNS)' : ''}</code> : '—'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                        {s.bytes != null ? fmtBytes(s.bytes) : <span style={{ color: 'var(--text2)' }}>—</span>}
                      </td>
                      <td><WanBadge wan={s.wan} /></td>
                      <td>
                        <span className="badge badge-green">
                          <span className="dot dot-green" /> {s.state}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} ·{' '}
            {data.sessions?.length > 0 && sessions.some(s => s.bytes == null) && 'Byte counts require conntrack · '}
            Auto-refreshes every 20s
          </div>
        )}
      </div>
    </div>
  );
}

function isPublicIp(ip) {
  if (!ip) return false;
  return !(
    ip.startsWith('10.')     ||
    ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') || ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') || ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') || ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') || ip.startsWith('172.31.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.')
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
            LAN bandwidth usage · WAN connection sessions
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
            {t.key === 'lan' ? '🖥️ ' : '🌐 '}{t.label}
          </button>
        ))}
      </div>

      {tab === 'lan' && <LanSection toast={toast} />}
      {tab === 'wan' && <WanSection toast={toast} />}
    </div>
  );
}
