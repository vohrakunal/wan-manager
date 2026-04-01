import React, { useState } from 'react';
import ThroughputChart from './ThroughputChart.jsx';

function fmtBytes(b) {
  if (b == null) return '—';
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function fmtRate(bps) {
  if (bps == null || isNaN(bps)) return '—';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' KB/s';
  return Math.round(bps) + ' B/s';
}

function latencyColor(ms) {
  if (ms == null) return 'var(--text2)';
  if (ms < 50)  return 'var(--green)';
  if (ms < 150) return 'var(--yellow)';
  return 'var(--red)';
}

export default function WanCard({ label, isp, wan, history = [] }) {
  const [copied, setCopied] = useState(false);
  const isUp = wan?.status === 'up';

  function copyIp() {
    if (!wan?.publicIp) return;
    navigator.clipboard.writeText(wan.publicIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card" style={{ border: `1px solid ${isUp ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{isp}</div>
        </div>
        <span className={`badge ${isUp ? 'badge-green' : 'badge-red'}`}>
          <span className={`dot ${isUp ? 'dot-green' : 'dot-red'}`} />
          {isUp ? 'UP' : 'DOWN'}
        </span>
      </div>

      {/* Stats */}
      <div style={{ marginBottom: 16 }}>
        <div className="stat-row">
          <span className="stat-label">Interface</span>
          <span className="stat-value" style={{ fontSize: 11, fontFamily: 'monospace' }}>{wan?.interface || '—'}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Local IP</span>
          <span className="stat-value">{wan?.ip || '—'}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Public IP</span>
          <span className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {wan?.publicIp || '—'}
            {wan?.publicIp && (
              <button onClick={copyIp} style={{ background: 'none', padding: '2px 6px', fontSize: 11, color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 4 }}>
                {copied ? '✓' : 'Copy'}
              </button>
            )}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Gateway</span>
          <span className="stat-value">{wan?.gateway || '—'}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Latency</span>
          <span className="stat-value" style={{ color: latencyColor(wan?.latency) }}>
            {wan?.latency != null ? `${wan.latency} ms` : '—'}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">RX / TX</span>
          <span className="stat-value" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--green)' }}>{fmtRate(wan?.rxRate)}</span>
            {' / '}
            <span style={{ color: 'var(--accent)' }}>{fmtRate(wan?.txRate)}</span>
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Total RX / TX</span>
          <span className="stat-value" style={{ fontSize: 12 }}>{fmtBytes(wan?.rxBytes)} / {fmtBytes(wan?.txBytes)}</span>
        </div>
      </div>

      {/* Chart */}
      <ThroughputChart data={history} />
    </div>
  );
}
