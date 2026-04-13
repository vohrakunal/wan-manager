import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const ALLOWED_CMDS = [
  'ping', 'traceroute', 'tracepath', 'ip', 'ss', 'netstat',
  'nslookup', 'dig', 'host', 'curl', 'wget', 'iperf3', 'iperf',
  'cat', 'tail', 'grep', 'journalctl', 'systemctl', 'dmesg',
  'df', 'du', 'free', 'top', 'htop', 'ps', 'uptime', 'uname',
  'hostname', 'date', 'who', 'w', 'ifconfig', 'arp', 'route',
  'mtr', 'nmap', 'tcpdump', 'iptables', 'ip6tables',
  'clear', 'ls', 'pwd', 'echo', 'help',
];

export default function Terminal() {
  const containerRef = useRef(null);
  const termRef   = useRef(null);
  const fitAddon  = useRef(null);
  const wsRef     = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    const term = new XTerm({
      theme: {
        background: '#0a0e13',
        foreground: '#e6edf3',
        cursor:     '#2f81f7',
        selectionBackground: 'rgba(47,129,247,0.3)',
        black:   '#0d1117', red:     '#f85149', green:   '#3fb950',
        yellow:  '#d29922', blue:    '#2f81f7', magenta: '#bc8cff',
        cyan:    '#39c5cf', white:   '#e6edf3',
        brightBlack:   '#6e7681', brightRed:     '#ff7b72',
        brightGreen:   '#56d364', brightYellow:  '#e3b341',
        brightBlue:    '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan:    '#56d4dd', brightWhite:   '#f0f6fc',
      },
      fontFamily: "'SFMono-Regular', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    // Banner
    term.writeln('\x1b[1;34m╔══════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;34m║          WAN Manager — Restricted Shell               ║\x1b[0m');
    term.writeln('\x1b[1;34m╚══════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('\x1b[2mOnly network / diagnostic commands are permitted.\x1b[0m');
    term.writeln('\x1b[2mType \x1b[0mhelp\x1b[2m or any allowed command below.\x1b[0m\r\n');

    // Connect WebSocket
    const token = localStorage.getItem('token');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send initial resize
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        if (msg.type === 'error')  term.writeln(`\x1b[31m${msg.data}\x1b[0m`);
        if (msg.type === 'exit')   term.writeln('\r\n\x1b[33m[Session ended]\x1b[0m');
      } catch {}
    };

    ws.onerror = () => setError('WebSocket connection failed');
    ws.onclose = () => setConnected(false);

    // Terminal → WS
    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(containerRef.current);

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    return () => {
      ws.close();
      term.dispose();
      ro.disconnect();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Terminal</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            Restricted shell — network & diagnostic commands only
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
          <span className={`badge ${connected ? 'badge-green' : 'badge-gray'}`}>
            <span className={`dot ${connected ? 'dot-green' : ''}`} style={!connected ? { background: 'var(--text2)' } : {}} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <button
            className="btn-secondary"
            style={{ fontSize: 12 }}
            onClick={() => { termRef.current?.clear(); }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Allowed commands reference */}
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--text2)',
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text)', marginRight: 4 }}>Allowed:</span>
        {ALLOWED_CMDS.map(c => (
          <code key={c} style={{
            background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4,
            color: 'var(--accent2)', fontSize: 11,
          }}>{c}</code>
        ))}
      </div>

      {/* xterm container */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{
            background: '#0a0e13',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px',
            height: 'calc(100vh - 280px)',
            minHeight: 300,
            overflow: 'hidden',
          }}
        />
      </div>
    </div>
  );
}
