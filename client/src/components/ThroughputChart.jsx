import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function fmtBytes(bps) {
  if (bps == null || isNaN(bps)) return '0 B/s';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' KB/s';
  return bps.toFixed(0) + ' B/s';
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text2)', marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {fmtBytes(p.value)}
        </div>
      ))}
    </div>
  );
}

export default function ThroughputChart({ data = [], title = '' }) {
  const chartData = data.slice(-60).map((d, i) => ({
    t: i,
    rx: d.rxRate || 0,
    tx: d.txRate || 0,
  }));

  return (
    <div style={{ marginTop: 8 }}>
      {title && <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{title}</div>}
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis hide tickFormatter={fmtBytes} />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="rx" stroke="var(--green)"  dot={false} strokeWidth={1.5} name="RX" isAnimationActive={false} />
          <Line type="monotone" dataKey="tx" stroke="var(--accent)" dot={false} strokeWidth={1.5} name="TX" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
        <span><span style={{ color: 'var(--green)' }}>—</span> RX</span>
        <span><span style={{ color: 'var(--accent)' }}>—</span> TX</span>
      </div>
    </div>
  );
}
