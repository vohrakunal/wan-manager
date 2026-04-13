import React, { useState, useEffect } from 'react';

function fmt(bytes) {
  if (bytes == null) return '—';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function Bar({ pct, color }) {
  return (
    <div style={{
      height: 6, borderRadius: 3,
      background: 'var(--bg)',
      overflow: 'hidden', margin: '4px 0 2px',
    }}>
      <div style={{
        height: '100%',
        width: `${Math.min(100, pct || 0)}%`,
        background: color || 'var(--accent)',
        borderRadius: 3,
        transition: 'width 0.4s',
      }} />
    </div>
  );
}

export default function SysInfo() {
  const [info, setInfo] = useState(null);

  async function load() {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/diagnostics/sysinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setInfo(await r.json());
    } catch {}
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;

  const cpuColor = info.cpuPct > 80 ? 'var(--red)' : info.cpuPct > 50 ? 'var(--yellow)' : 'var(--green)';
  const memColor = info.memPct > 85 ? 'var(--red)' : info.memPct > 60 ? 'var(--yellow)' : 'var(--accent)';

  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="card-title" style={{ margin: 0 }}>System</div>
        <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'monospace' }}>{info.hostname}</span>
      </div>

      <div className="grid-3" style={{ gap: 16 }}>
        {/* CPU */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>CPU Usage</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: cpuColor, fontFamily: 'monospace' }}>
            {info.cpuPct != null ? `${info.cpuPct}%` : '—'}
          </div>
          <Bar pct={info.cpuPct} color={cpuColor} />
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {info.cpuCount}× {info.cpuModel?.split('@')[0]?.trim()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            Load: {info.loadAvg?.join(' / ')}
          </div>
        </div>

        {/* Memory */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Memory</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: memColor, fontFamily: 'monospace' }}>
            {info.memPct != null ? `${info.memPct}%` : '—'}
          </div>
          <Bar pct={info.memPct} color={memColor} />
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {fmt(info.usedMem)} / {fmt(info.totalMem)} used
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            Free: {fmt(info.freeMem)}
          </div>
        </div>

        {/* System */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Uptime</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>
            {fmtUptime(info.uptime)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
            Kernel: {info.kernel}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            {info.platform} / {info.arch}
          </div>
        </div>
      </div>
    </div>
  );
}
