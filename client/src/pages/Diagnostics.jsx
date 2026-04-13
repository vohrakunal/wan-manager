import React, { useState, useRef, useCallback } from 'react';

const PRESETS = [
  { label: 'Google DNS',    host: '8.8.8.8' },
  { label: 'Cloudflare',   host: '1.1.1.1' },
  { label: 'OpenDNS',      host: '208.67.222.222' },
  { label: 'Google.com',   host: 'google.com' },
  { label: 'Gateway',      host: '192.168.1.1' },
];

function ResultPanel({ results, running }) {
  const bottomRef = useRef(null);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [results]);

  return (
    <div style={{
      fontFamily: "'SFMono-Regular', Consolas, monospace",
      fontSize: 12, lineHeight: 1.6,
      background: '#0a0e13',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 14px',
      minHeight: 200,
      maxHeight: 420,
      overflowY: 'auto',
    }}>
      {results.length === 0 && !running && (
        <span style={{ color: 'var(--text2)' }}>Run a test to see output here…</span>
      )}
      {results.map((r, i) => {
        if (r.type === 'start') return (
          <div key={i} style={{ color: 'var(--accent2)', fontWeight: 700, marginTop: i > 0 ? 10 : 0 }}>
            ─── {r.label} ───
          </div>
        );
        if (r.type === 'done') return (
          <div key={i} style={{ color: r.code === 0 ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
            {r.code === 0 ? '✓ Success' : `✗ Exit code ${r.code}`}
          </div>
        );
        if (r.type === 'line') {
          const line = r.line || '';
          let color = 'var(--text)';
          if (/ttl|bytes from|ms/i.test(line)) color = 'var(--green)';
          if (/unreachable|failed|error|timeout|\* \* \*/i.test(line)) color = 'var(--red)';
          if (/^\s*\d+\s/.test(line) && /ms/i.test(line)) color = 'var(--text)';
          return <div key={i} style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>;
        }
        return null;
      })}
      {running && (
        <div style={{ color: 'var(--yellow)', marginTop: 4 }}>
          <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
          {' '}Running…
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

export default function Diagnostics() {
  const [tool, setTool] = useState('ping');
  const [host, setHost] = useState('8.8.8.8');
  const [iface, setIface] = useState('both');
  const [count, setCount] = useState(4);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const esRef = useRef(null);

  const stopTest = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }, []);

  const runTest = useCallback(() => {
    if (running) { stopTest(); return; }

    setResults([]);
    setRunning(true);

    const token = localStorage.getItem('token');
    let url;
    if (tool === 'ping') {
      url = `/api/diagnostics/ping?host=${encodeURIComponent(host)}&count=${count}&iface=${iface}&token=${token}`;
    } else {
      url = `/api/diagnostics/traceroute?host=${encodeURIComponent(host)}&iface=${iface === 'both' ? 'zte' : iface}&token=${token}`;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'end') { stopTest(); return; }
        setResults(prev => [...prev, msg]);
      } catch {}
    };

    es.onerror = () => stopTest();
  }, [tool, host, iface, count, running, stopTest]);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Diagnostics</div>
      </div>

      {/* Tool selector */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'ping',       label: 'Ping' },
          { key: 'traceroute', label: 'Traceroute' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTool(t.key); setResults([]); stopTest(); }}
            style={{
              padding: '8px 20px', background: 'transparent', fontSize: 13, fontWeight: 500,
              color: tool === t.key ? 'var(--text)' : 'var(--text2)',
              borderBottom: tool === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Controls */}
        <div className="card">
          <div className="card-title">Configuration</div>

          {/* Host presets */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Quick presets</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map(p => (
                <button
                  key={p.host}
                  onClick={() => setHost(p.host)}
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20 }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Host input */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>Target host / IP</label>
            <input
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="e.g. 8.8.8.8 or google.com"
              onKeyDown={e => e.key === 'Enter' && runTest()}
            />
          </div>

          {/* WAN interface */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>WAN interface</label>
            <select value={iface} onChange={e => setIface(e.target.value)}>
              {tool === 'ping' && <option value="both">Both WANs</option>}
              <option value="zte">ZTE (WAN 1)</option>
              <option value="digisol">DIGISOL (WAN 2)</option>
            </select>
          </div>

          {/* Ping count */}
          {tool === 'ping' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 6 }}>
                Packet count: <strong style={{ color: 'var(--text)' }}>{count}</strong>
              </label>
              <input
                type="range" min={1} max={20} value={count}
                onChange={e => setCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }}
              />
            </div>
          )}

          <button
            onClick={runTest}
            className={running ? 'btn-danger' : 'btn-primary'}
            style={{ width: '100%', fontWeight: 600 }}
          >
            {running ? '⏹ Stop' : `▶ Run ${tool === 'ping' ? 'Ping' : 'Traceroute'}`}
          </button>
        </div>

        {/* Results */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>Output</div>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setResults([])}
              disabled={running}
            >
              Clear
            </button>
          </div>
          <ResultPanel results={results} running={running} />
        </div>
      </div>
    </div>
  );
}
