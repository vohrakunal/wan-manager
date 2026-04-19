/**
 * GET  /api/diagnostics/ping?host=8.8.8.8&count=4&iface=zte|digisol|both
 * GET  /api/diagnostics/traceroute?host=8.8.8.8&iface=zte
 * GET  /api/diagnostics/sysinfo
 *
 * Ping/traceroute stream results as SSE so the UI gets live output.
 */
const router = require('express').Router();
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { NETWORK } = require('../lib/networkConfig');

const IFACE_MAP = {
  zte:     NETWORK.zte.iface,
  digisol: NETWORK.digisol.iface,
};

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function sendSse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Validate & sanitize a hostname / IP (no shell injection)
function safeHost(raw) {
  if (!raw) return null;
  const s = String(raw).trim().slice(0, 253);
  // allow IPv4, IPv6, hostnames
  if (!/^[a-zA-Z0-9.\-:_]+$/.test(s)) return null;
  return s;
}

function readTempC(path) {
  try {
    const raw = parseInt(fs.readFileSync(path, 'utf8').trim(), 10);
    if (isNaN(raw) || raw <= 0) return null;
    const c = raw > 1000 ? raw / 1000 : raw;
    if (c < 1 || c > 150) return null;
    return Math.round(c * 10) / 10;
  } catch {
    return null;
  }
}

function scoreSensorText(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return 0;
  if (s.includes('package id')) return 120;
  if (s.includes('x86_pkg_temp') || s.includes('tdie') || s.includes('tctl')) return 110;
  if (s.includes('coretemp')) return 100;
  if (s.includes('cpu') || s.includes('core') || s.includes('package')) return 90;
  if (s.includes('soc')) return 60;
  if (s.includes('acpitz') || s.includes('pch')) return 20;
  return 40;
}

function detectCpuTemp() {
  const candidates = [];

  // thermal_zone* sensors
  try {
    for (const entry of fs.readdirSync('/sys/class/thermal')) {
      if (!entry.startsWith('thermal_zone')) continue;
      const base = `/sys/class/thermal/${entry}`;
      const type = fs.readFileSync(`${base}/type`, 'utf8').trim();
      const temp = readTempC(`${base}/temp`);
      if (temp == null) continue;
      const score = scoreSensorText(type);
      candidates.push({
        score,
        temp,
        source: `${base}/temp`,
      });
    }
  } catch {}

  // hwmon temp*_input sensors
  try {
    for (const hw of fs.readdirSync('/sys/class/hwmon')) {
      if (!hw.startsWith('hwmon')) continue;
      const base = `/sys/class/hwmon/${hw}`;
      let name = '';
      try { name = fs.readFileSync(`${base}/name`, 'utf8').trim(); } catch {}

      for (const f of fs.readdirSync(base)) {
        const m = f.match(/^temp(\d+)_input$/);
        if (!m) continue;
        const temp = readTempC(`${base}/${f}`);
        if (temp == null) continue;

        let label = '';
        try { label = fs.readFileSync(`${base}/temp${m[1]}_label`, 'utf8').trim(); } catch {}
        const score = scoreSensorText(`${name} ${label}`);
        candidates.push({
          score,
          temp,
          source: `${base}/${f}`,
        });
      }
    }
  } catch {}

  if (candidates.length === 0) return { cpuTemp: null, cpuTempSource: null };
  candidates.sort((a, b) => b.score - a.score || b.temp - a.temp);
  return { cpuTemp: candidates[0].temp, cpuTempSource: candidates[0].source };
}

// GET /api/diagnostics/ping  (SSE)
router.get('/ping', (req, res) => {
  sseSetup(res);

  const host  = safeHost(req.query.host) || '8.8.8.8';
  const count = Math.min(Math.max(parseInt(req.query.count) || 4, 1), 20);
  const iface = req.query.iface;

  function runPing(label, args) {
    return new Promise(resolve => {
      sendSse(res, { type: 'start', label });
      const proc = spawn('ping', args, { timeout: 30000 });

      proc.stdout.on('data', d => sendSse(res, { type: 'line', label, line: d.toString() }));
      proc.stderr.on('data', d => sendSse(res, { type: 'line', label, line: d.toString() }));
      proc.on('close', code => {
        sendSse(res, { type: 'done', label, code });
        resolve();
      });
      req.on('close', () => proc.kill());
    });
  }

  async function go() {
    const targets = [];
    if (iface === 'zte' || iface === 'both' || !iface) {
      const a = ['-c', count, '-W', '2', host];
      if (IFACE_MAP.zte) a.push('-I', IFACE_MAP.zte);
      targets.push(['ZTE (WAN 1)', a]);
    }
    if (iface === 'digisol' || iface === 'both') {
      const a = ['-c', count, '-W', '2', host];
      if (IFACE_MAP.digisol) a.push('-I', IFACE_MAP.digisol);
      targets.push(['DIGISOL (WAN 2)', a]);
    }

    for (const [label, args] of targets) {
      await runPing(label, args);
    }
    sendSse(res, { type: 'end' });
    res.end();
  }

  go().catch(() => res.end());
});

// GET /api/diagnostics/traceroute  (SSE)
router.get('/traceroute', (req, res) => {
  sseSetup(res);

  const host  = safeHost(req.query.host) || '8.8.8.8';
  const iface = req.query.iface;

  const args = ['-m', '20', host];
  const label = iface && IFACE_MAP[iface]
    ? `Traceroute via ${iface.toUpperCase()}`
    : 'Traceroute';

  if (iface && IFACE_MAP[iface]) args.push('-i', IFACE_MAP[iface]);

  sendSse(res, { type: 'start', label });
  const proc = spawn('traceroute', args, { timeout: 60000 });
  proc.stdout.on('data', d => sendSse(res, { type: 'line', label, line: d.toString() }));
  proc.stderr.on('data', d => sendSse(res, { type: 'line', label, line: d.toString() }));
  proc.on('close', code => {
    sendSse(res, { type: 'done', label, code });
    sendSse(res, { type: 'end' });
    res.end();
  });
  req.on('close', () => proc.kill());
});

// GET /api/diagnostics/sysinfo  — JSON snapshot
router.get('/sysinfo', (req, res) => {
  try {
    const cpus     = os.cpus();
    const loadAvg  = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const uptime   = os.uptime(); // seconds

    // Parse /proc/stat for CPU % (one-shot, compare to self 500ms later)
    function readCpuStat() {
      try {
        const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
        const parts = line.split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        return { idle, total };
      } catch { return null; }
    }

    const s1 = readCpuStat();
    setTimeout(() => {
      const s2 = readCpuStat();
      let cpuPct = null;
      if (s1 && s2) {
        const dTotal = s2.total - s1.total;
        const dIdle  = s2.idle  - s1.idle;
        cpuPct = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 1000) / 10 : 0;
      }

      const { cpuTemp, cpuTempSource } = detectCpuTemp();

      res.json({
        hostname: os.hostname(),
        platform: os.platform(),
        arch:     os.arch(),
        kernel:   os.release(),
        uptime,
        cpuModel: cpus[0]?.model || 'unknown',
        cpuCount: cpus.length,
        cpuPct,
        cpuTemp,
        cpuTempSource,
        loadAvg: loadAvg.map(v => Math.round(v * 100) / 100),
        totalMem,
        freeMem,
        usedMem: totalMem - freeMem,
        memPct:  Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
      });
    }, 500);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diagnostics/check-router?speedtest=0|1  — SSE, streams check-router output
router.get('/check-router', (req, res) => {
  sseSetup(res);

  const args = ['/usr/local/bin/check-router'];
  if (req.query.speedtest === '1') args.push('--speedtest');

  sendSse(res, { type: 'start', label: 'check-router' });

  const proc = spawn(args[0], args.slice(1), { timeout: 120000 });

  proc.stdout.on('data', d => {
    d.toString().split('\n').forEach(line => {
      if (line) sendSse(res, { type: 'line', line });
    });
  });
  proc.stderr.on('data', d => {
    d.toString().split('\n').forEach(line => {
      if (line) sendSse(res, { type: 'line', line });
    });
  });
  proc.on('close', code => {
    sendSse(res, { type: 'done', code });
    sendSse(res, { type: 'end' });
    res.end();
  });

  req.on('close', () => proc.kill());
});

module.exports = router;
