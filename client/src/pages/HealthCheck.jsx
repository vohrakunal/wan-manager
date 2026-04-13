import React, { useState, useRef, useEffect } from 'react';

// Classify each output line for colour + section grouping
function classifyLine(line) {
  const l = line.toLowerCase();
  if (/✓|ok|up|pass|success|healthy|both wan|ecmp|active/i.test(line)) return 'ok';
  if (/✗|fail|down|error|critical|unreachable|timeout|bad|wrong/i.test(line)) return 'error';
  if (/warn|degraded|slow|high latency|packet loss|check/i.test(line)) return 'warn';
  if (/={3,}|-{3,}|#{3,}|\[.*\]/i.test(line)) return 'heading';
  return 'normal';
}

const LINE_COLORS = {
  ok:      'var(--green)',
  error:   'var(--red)',
  warn:    'var(--yellow)',
  heading: 'var(--accent2)',
  normal:  'var(--text)',
};

function OutputLine({ line }) {
  const kind = classifyLine(line);
  return (
    <div style={{
      color: LINE_COLORS[kind],
      fontFamily: "'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.7,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      fontWeight: kind === 'heading' ? 700 : 400,
      borderLeft: kind === 'heading' ? '3px solid var(--accent)' : '3px solid transparent',
      paddingLeft: kind === 'heading' ? 8 : 8,
      marginTop: kind === 'heading' ? 8 : 0,
    }}>
      {line}
    </div>
  );
}

export default function HealthCheck() {
  const [lines, setLines]         = useState([]);
  const [running, setRunning]     = useState(false);
  const [done, setDone]           = useState(false);
  const [exitCode, setExitCode]   = useState(null);
  const [speedtest, setSpeedtest] = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const esRef     = useRef(null);
  const timerRef  = useRef(null);
  const bottomRef = useRef(null);
  const startRef  = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Elapsed timer
  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [running]);

  function stop() {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }

  function run() {
    if (running) { stop(); return; }

    setLines([]);
    setDone(false);
    setExitCode(null);
    setElapsed(0);
    setRunning(true);

    const token = localStorage.getItem('token');
    const url = `/api/diagnostics/check-router?speedtest=${speedtest ? 1 : 0}&token=${token}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'line') {
          setLines(prev => [...prev, msg.line]);
        } else if (msg.type === 'done') {
          setExitCode(msg.code);
          setDone(true);
        } else if (msg.type === 'end') {
          stop();
        }
      } catch {}
    };

    es.onerror = () => stop();
  }

  const okCount   = lines.filter(l => classifyLine(l) === 'ok').length;
  const errCount  = lines.filter(l => classifyLine(l) === 'error').length;
  const warnCount = lines.filter(l => classifyLine(l) === 'warn').length;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Health Check</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            Runs <code style={{ color: 'var(--accent2)' }}>/usr/local/bin/check-router</code> and streams live output
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {running && (
            <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace' }}>
              {elapsed}s
            </span>
          )}
          <button
            onClick={run}
            className={running ? 'btn-danger' : 'btn-primary'}
            style={{ fontWeight: 600, minWidth: 140 }}
          >
            {running ? '⏹ Stop' : '▶ Run Health Check'}
          </button>
        </div>
      </div>

      {/* Options */}
      <div className="card section-gap" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={speedtest}
              onChange={e => setSpeedtest(e.target.checked)}
              disabled={running}
              style={{ width: 'auto', cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            Include speedtest <span style={{ fontSize: 11, color: 'var(--text2)' }}>(~60s extra)</span>
          </label>

          {/* Summary badges — only after a run */}
          {(done || lines.length > 0) && (
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              {okCount > 0   && <span className="badge badge-green">{okCount} OK</span>}
              {warnCount > 0 && <span className="badge badge-yellow">{warnCount} WARN</span>}
              {errCount > 0  && <span className="badge badge-red">{errCount} FAIL</span>}
              {done && exitCode === 0 && <span className="badge badge-green">Exit 0 — Passed</span>}
              {done && exitCode !== 0 && <span className="badge badge-red">Exit {exitCode} — Issues found</span>}
            </div>
          )}
        </div>
      </div>

      {/* Output panel */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{
          background: '#0a0e13',
          borderRadius: 8,
          padding: '14px 16px',
          minHeight: 200,
          maxHeight: 'calc(100vh - 340px)',
          overflowY: 'auto',
        }}>
          {lines.length === 0 && !running && (
            <div style={{ color: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}>
              Press "Run Health Check" to execute check-router…
            </div>
          )}
          {lines.map((line, i) => <OutputLine key={i} line={line} />)}
          {running && lines.length === 0 && (
            <div style={{ color: 'var(--text2)', fontSize: 12, fontFamily: 'monospace' }}>
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
              {' '}Starting check-router…
            </div>
          )}
          {running && lines.length > 0 && (
            <div style={{ color: 'var(--yellow)', fontSize: 12, fontFamily: 'monospace', marginTop: 4 }}>
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
              {' '}Running…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer bar */}
        <div style={{
          padding: '7px 14px', fontSize: 11, color: 'var(--text2)',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{lines.length} lines</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {lines.length > 0 && (
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => {
                  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `check-router-${new Date().toISOString().slice(0,19)}.txt`;
                  a.click();
                }}
              >
                ↓ Download
              </button>
            )}
            {lines.length > 0 && !running && (
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => { setLines([]); setDone(false); setExitCode(null); }}
              >
                Clear
              </button>
            )}
            <span style={{ color: running ? 'var(--yellow)' : done ? (exitCode === 0 ? 'var(--green)' : 'var(--red)') : 'var(--text2)' }}>
              {running ? '● Running' : done ? (exitCode === 0 ? '✓ Done' : '✗ Done with errors') : '○ Idle'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
