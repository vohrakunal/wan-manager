import React, { useState } from 'react';

function fmtDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SegmentTooltip({ seg, visible, x }) {
  if (!visible) return null;
  const dur = new Date(seg.end) - new Date(seg.start);
  return (
    <div style={{
      position: 'absolute',
      top: -70,
      left: Math.min(x, 'calc(100% - 180px)'),
      transform: 'translateX(-50%)',
      background: 'var(--bg3)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '7px 11px',
      fontSize: 12,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 10,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    }}>
      <div style={{ color: seg.status === 'up' ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginBottom: 3 }}>
        {seg.status === 'up' ? 'Online' : 'Offline'} — {fmtDuration(dur)}
      </div>
      <div style={{ color: 'var(--text2)' }}>{fmtDateTime(seg.start)} → {fmtDateTime(seg.end)}</div>
    </div>
  );
}

function TimelineRow({ label, segments, since, now }) {
  const [tooltip, setTooltip] = useState(null);
  const totalMs = new Date(now) - new Date(since);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ position: 'relative', height: 28, display: 'flex', borderRadius: 4, overflow: 'hidden', background: 'var(--bg3)' }}>
        {segments.map((seg, i) => {
          const startPct = ((new Date(seg.start) - new Date(since)) / totalMs) * 100;
          const endPct   = ((new Date(seg.end)   - new Date(since)) / totalMs) * 100;
          const widthPct = Math.max(endPct - startPct, 0.2);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${startPct}%`,
                width: `${widthPct}%`,
                height: '100%',
                background: seg.status === 'up' ? 'var(--green)' : 'var(--red)',
                opacity: seg.status === 'up' ? 0.85 : 1,
                cursor: 'pointer',
                transition: 'opacity 0.1s',
              }}
              onMouseEnter={e => {
                const rect = e.currentTarget.parentElement.getBoundingClientRect();
                const segRect = e.currentTarget.getBoundingClientRect();
                setTooltip({ seg, x: segRect.left - rect.left + segRect.width / 2 });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
        {tooltip && <SegmentTooltip seg={tooltip.seg} visible x={tooltip.x} />}
      </div>
    </div>
  );
}

function XAxisLabels({ since, now, ticks = 5 }) {
  const totalMs = new Date(now) - new Date(since);
  const labels = Array.from({ length: ticks + 1 }, (_, i) => {
    const ts = new Date(new Date(since).getTime() + (totalMs * i) / ticks);
    return { pct: (i / ticks) * 100, label: fmtTime(ts) };
  });
  return (
    <div style={{ position: 'relative', height: 18, marginTop: 4 }}>
      {labels.map(({ pct, label }) => (
        <span key={pct} style={{
          position: 'absolute',
          left: `${pct}%`,
          transform: 'translateX(-50%)',
          fontSize: 10,
          color: 'var(--text2)',
          whiteSpace: 'nowrap',
        }}>{label}</span>
      ))}
    </div>
  );
}

export default function UptimeTimeline({ data, hours, onHoursChange }) {
  if (!data) {
    return (
      <div style={{ color: 'var(--text2)', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>
        Loading uptime timeline…
      </div>
    );
  }

  const { zte, digisol, since, now } = data;

  const zteDowntime     = zte.filter(s => s.status === 'down').reduce((a, s) => a + (new Date(s.end) - new Date(s.start)), 0);
  const digisolDowntime = digisol.filter(s => s.status === 'down').reduce((a, s) => a + (new Date(s.end) - new Date(s.start)), 0);
  const totalMs         = new Date(now) - new Date(since);

  const uptimePct = ms => totalMs > 0 ? (((totalMs - ms) / totalMs) * 100).toFixed(1) : '100.0';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>WAN Uptime Timeline</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[6, 12, 24, 48].map(h => (
            <button
              key={h}
              onClick={() => onHoursChange(h)}
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: hours === h ? 'var(--accent)' : 'var(--bg3)',
                color: hours === h ? '#fff' : 'var(--text2)',
                cursor: 'pointer',
              }}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text2)' }}>ZTE uptime: </span>
          <span style={{ color: zteDowntime > 0 ? 'var(--yellow)' : 'var(--green)', fontWeight: 600 }}>
            {uptimePct(zteDowntime)}%
          </span>
          {zteDowntime > 0 && <span style={{ color: 'var(--text2)', marginLeft: 6 }}>({fmtDuration(zteDowntime)} down)</span>}
        </div>
        <div style={{ fontSize: 12 }}>
          <span style={{ color: 'var(--text2)' }}>DIGISOL uptime: </span>
          <span style={{ color: digisolDowntime > 0 ? 'var(--yellow)' : 'var(--green)', fontWeight: 600 }}>
            {uptimePct(digisolDowntime)}%
          </span>
          {digisolDowntime > 0 && <span style={{ color: 'var(--text2)', marginLeft: 6 }}>({fmtDuration(digisolDowntime)} down)</span>}
        </div>
      </div>

      {zte.length === 0 && digisol.length === 0 ? (
        <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          No data yet — timeline builds as status checks run.
        </div>
      ) : (
        <>
          <TimelineRow label="ZTE (WAN 1)"     segments={zte}     since={since} now={now} />
          <TimelineRow label="DIGISOL (WAN 2)" segments={digisol} since={since} now={now} />
          <XAxisLabels since={since} now={now} />
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--green)', marginRight: 4, verticalAlign: 'middle' }} />Online</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--red)', marginRight: 4, verticalAlign: 'middle' }} />Offline</span>
          </div>
        </>
      )}
    </div>
  );
}
