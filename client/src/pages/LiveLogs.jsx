import React, { useState, useEffect, useRef } from 'react';
import { getFailoverLog, getActionLogs } from '../api/index.js';

const LOG_COLORS = {
  ok:       'var(--green)',
  restored: 'var(--green)',
  up:       'var(--green)',
  warn:     'var(--yellow)',
  warning:  'var(--yellow)',
  fail:     'var(--red)',
  failover: 'var(--red)',
  critical: 'var(--red)',
  error:    'var(--red)',
  down:     'var(--red)',
};

function colorLine(line) {
  const lower = line.toLowerCase();
  for (const [key, color] of Object.entries(LOG_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return 'var(--text)';
}

function LogLine({ line }) {
  return (
    <div style={{ color: colorLine(line), padding: '1px 0', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, wordBreak: 'break-all' }}>
      {line}
    </div>
  );
}

export default function LiveLogs() {
  const [lines, setLines] = useState([]);
  const [actionLogs, setActionLogs] = useState([]);
  const [tab, setTab] = useState('failover');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const evtRef = useRef(null);

  // Action logs
  useEffect(() => {
    getActionLogs(50).then(({ data }) => setActionLogs(data)).catch(() => {});
  }, []);

  // SSE log stream
  useEffect(() => {
    if (tab !== 'failover') return;

    // Load initial lines
    setLoading(true);
    getFailoverLog(200).then(({ data }) => {
      setLines(data.lines || []);
      setLoading(false);
    }).catch(() => setLoading(false));

    const token = localStorage.getItem('token');
    const es = new EventSource(`/api/stream/logs?token=${token}`);
    evtRef.current = es;

    es.onmessage = e => {
      try {
        const { lines: newLines, initial } = JSON.parse(e.data);
        if (initial) {
          setLines(newLines);
        } else {
          setLines(prev => [...prev, ...newLines].slice(-2000));
        }
      } catch {}
    };

    return () => es.close();
  }, [tab]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll]);

  function downloadLog() {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wan-failover.log';
    a.click();
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Live Logs</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'failover' && (
            <>
              <button className="btn-secondary" onClick={() => setAutoScroll(v => !v)} style={{ fontSize: 12 }}>
                {autoScroll ? '⏸ Pause Scroll' : '▶ Auto-Scroll'}
              </button>
              <button className="btn-secondary" onClick={() => setLines([])} style={{ fontSize: 12 }}>
                ✕ Clear Display
              </button>
              <button className="btn-secondary" onClick={downloadLog} style={{ fontSize: 12 }}>
                ↓ Download
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'failover', label: 'Failover Log' },
          { key: 'actions',  label: 'Action History' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', background: 'transparent', fontSize: 13, fontWeight: 500,
              color: tab === t.key ? 'var(--text)' : 'var(--text2)',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'failover' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{
            fontFamily: 'monospace', fontSize: 12, background: '#0a0e13',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '12px 14px', height: 500, overflowY: 'auto',
          }}>
            {loading ? (
              <div style={{ color: 'var(--text2)', padding: 20 }}>Loading…</div>
            ) : lines.length === 0 ? (
              <div style={{ color: 'var(--text2)', padding: 20 }}>No log entries yet. Waiting for events…</div>
            ) : (
              lines.map((l, i) => <LogLine key={i} line={l} />)
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{lines.length} lines</span>
            <span>● Live</span>
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {actionLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text2)', padding: 24 }}>No actions logged yet</td></tr>
                ) : actionLogs.map(log => (
                  <tr key={log._id}>
                    <td style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td><code style={{ color: 'var(--accent)', fontSize: 12 }}>{log.action}</code></td>
                    <td style={{ color: 'var(--text2)' }}>{log.user}</td>
                    <td>
                      <span className={`badge ${log.success ? 'badge-green' : 'badge-red'}`}>
                        {log.success ? 'OK' : 'FAIL'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {log.output || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
