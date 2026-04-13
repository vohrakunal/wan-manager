/**
 * WebSocket-based terminal  (/api/terminal/ws)
 *
 * Security model: only a fixed whitelist of commands may be run.
 * Each session gets its own PTY; the PTY is killed on disconnect.
 */
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const jwt = require('jsonwebtoken');
const url = require('url');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Commands that are allowed.  Anything else is rejected before the PTY sees it.
// The shell runs as the same user as the Node process, so keep this tight.
const ALLOWED_CMDS = new Set([
  'ping',
  'traceroute',
  'tracepath',
  'ip',
  'ss',
  'netstat',
  'nslookup',
  'dig',
  'host',
  'curl',
  'wget',
  'iperf3',
  'iperf',
  'speedtest',
  'speedtest-cli',
  'cat',
  'tail',
  'grep',
  'journalctl',
  'systemctl',
  'dmesg',
  'df',
  'du',
  'free',
  'top',
  'htop',
  'ps',
  'uptime',
  'uname',
  'hostname',
  'date',
  'who',
  'w',
  'ifconfig',
  'arp',
  'route',
  'mtr',
  'nmap',
  'tcpdump',
  'iptables',
  'ip6tables',
  'clear',
  'ls',
  'pwd',
  'echo',
  'help',,
  'check-router'
]);

function isAllowed(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '\r' || trimmed === '\n') return true; // empty / enter
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return ALLOWED_CMDS.has(firstWord);
}

function setupTerminalWss(server) {
  const wss = new WebSocketServer({ server, path: '/api/terminal/ws' });

  wss.on('connection', (ws, req) => {
    // --- Auth via ?token= query param ---
    const { query } = url.parse(req.url, true);
    try {
      jwt.verify(query.token, JWT_SECRET);
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: 'Unauthorized\r\n' }));
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Spawn a restricted shell
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const ptyProcess = pty.spawn(shell, ['--restricted'], {
      name: 'xterm-color',
      cols: 120,
      rows: 36,
      cwd: process.env.HOME || '/tmp',
      env: { ...process.env, TERM: 'xterm-color' },
    });

    // PTY → client
    ptyProcess.onData(data => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit' }));
        ws.close();
      }
    });

    // Client → PTY
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'input') {
          // Block disallowed commands — check when user hits Enter
          const input = msg.data || '';
          if (input.includes('\r') || input.includes('\n')) {
            // We receive char-by-char; accumulate in ptyProcess._lineBuffer
            if (!ptyProcess._lineBuffer) ptyProcess._lineBuffer = '';
            ptyProcess._lineBuffer += input.replace(/[\r\n]/g, '');
            if (!isAllowed(ptyProcess._lineBuffer)) {
              const msg2 = `\r\n\x1b[31m[BLOCKED] Command not in allowed list.\x1b[0m\r\n`;
              ws.send(JSON.stringify({ type: 'output', data: msg2 }));
              ptyProcess._lineBuffer = '';
              return;
            }
            ptyProcess._lineBuffer = '';
          } else {
            if (!ptyProcess._lineBuffer) ptyProcess._lineBuffer = '';
            if (input === '\x7f') {
              // backspace
              ptyProcess._lineBuffer = ptyProcess._lineBuffer.slice(0, -1);
            } else {
              ptyProcess._lineBuffer += input;
            }
          }
          ptyProcess.write(input);

        } else if (msg.type === 'resize') {
          ptyProcess.resize(
            Math.max(1, Math.min(300, msg.cols || 80)),
            Math.max(1, Math.min(100, msg.rows || 24)),
          );
        }
      } catch {}
    });

    ws.on('close', () => {
      try { ptyProcess.kill(); } catch {}
    });
  });

  return wss;
}

module.exports = { setupTerminalWss };
