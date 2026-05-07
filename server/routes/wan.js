const router = require('express').Router();
const { exec } = require('child_process');
const fs = require('fs');
const { readProcNetDev } = require('../lib/parser');
const ThroughputSnapshot = require('../models/ThroughputSnapshot');
const { NETWORK: INTERFACES } = require('../lib/networkConfig');

const FAILOVER_LOG = process.env.FAILOVER_LOG || '/var/log/wan-failover.log';

// Parse a single log line into { timestamp, zte, digisol } or null
// Log formats seen:
//   "2026-05-07 09:45:05 OK: DIGISOL only (ZTE still down)"
//   "2026-05-07 12:36:03 RESTORED: Both WANs up — ECMP 50:50 active"
//   "2026-05-07 12:37:03 OK: Both WANs up — ECMP 50:50 active"
//   "2026-05-07 XX:XX:XX OK: ZTE only (DIGISOL still down)"
//   "2026-05-07 XX:XX:XX CRITICAL: Both WANs down"
function parseLogLine(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.+)$/);
  if (!m) return null;
  const ts  = new Date(m[1]);
  const msg = m[2].toLowerCase();

  // Both down
  if (msg.includes('critical') || (msg.includes('both') && msg.includes('down'))) {
    return { timestamp: ts, zte: 'down', digisol: 'down' };
  }
  // Both up
  if (msg.includes('both') && (msg.includes('up') || msg.includes('ecmp'))) {
    return { timestamp: ts, zte: 'up', digisol: 'up' };
  }
  // Only DIGISOL up (ZTE down)
  if (msg.includes('digisol only') || msg.includes('zte still down') || msg.includes('zte down')) {
    return { timestamp: ts, zte: 'down', digisol: 'up' };
  }
  // Only ZTE up (DIGISOL down)
  if (msg.includes('zte only') || msg.includes('digisol still down') || msg.includes('digisol down')) {
    return { timestamp: ts, zte: 'up', digisol: 'down' };
  }
  return null;
}

// Read the failover log and return per-WAN up/down segments within the time window
function parseStatusTimeline(hours) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const now   = new Date();

  if (!fs.existsSync(FAILOVER_LOG)) {
    return { zte: [], digisol: [], since: since.toISOString(), now: now.toISOString() };
  }

  const content = fs.readFileSync(FAILOVER_LOG, 'utf8');
  const entries = content.split('\n')
    .map(parseLogLine)
    .filter(e => e && e.timestamp >= since);

  function toSegments(wan) {
    const segments = [];
    let seg = null;
    for (const e of entries) {
      const st = e[wan];
      if (!seg || seg.status !== st) {
        if (seg) { seg.end = e.timestamp.toISOString(); segments.push(seg); }
        seg = { status: st, start: e.timestamp.toISOString(), end: null };
      }
    }
    if (seg) { seg.end = now.toISOString(); segments.push(seg); }
    return segments;
  }

  return { zte: toSegments('zte'), digisol: toSegments('digisol'), since: since.toISOString(), now: now.toISOString() };
}

// Cache for throughput rate calculation (needs two readings)
let prevNetDev = null;
let prevNetDevTime = null;

function execAsync(cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

async function pingLatency(iface) {
  try {
    const out = await execAsync(`ping -I ${iface} -c 3 -W 2 8.8.8.8`, 10000);
    const match = out.match(/rtt min\/avg\/max.*?=\s*[\d.]+\/([\d.]+)/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

async function curlLatency(iface) {
  try {
    const out = await execAsync(`curl --interface ${iface} -s --max-time 5 -o /dev/null -w "%{time_total}" http://1.1.1.1`, 6000);
    const val = parseFloat(out);
    return isNaN(val) ? null : Math.round(val * 1000);
  } catch {
    return null;
  }
}

async function getPublicIp(iface) {
  try {
    return await execAsync(`curl --interface ${iface} -s --max-time 5 https://ifconfig.io`, 6000);
  } catch {
    return null;
  }
}

async function getWanStatus() {
  const [zteLatency, digiLatency, routeDefault] = await Promise.allSettled([
    pingLatency(INTERFACES.zte.iface),
    curlLatency(INTERFACES.digisol.iface),
    execAsync('ip route show default'),
  ]);

  const route = routeDefault.value || '';
  let mode = 'unknown';
  if (route.includes('nexthop') && route.includes(INTERFACES.zte.iface) && route.includes(INTERFACES.digisol.iface)) {
    mode = 'ecmp';
  } else if (route.includes(INTERFACES.zte.iface)) {
    mode = 'zte-only';
  } else if (route.includes(INTERFACES.digisol.iface)) {
    mode = 'digisol-only';
  }

  const hashMatch = route.match(/hash_policy[=\s]+(\d)/);
  let hashPolicy = null;
  if (!hashMatch) {
    try {
      const h = await execAsync('sysctl net.ipv4.fib_multipath_hash_policy');
      const m = h.match(/=\s*(\d)/);
      if (m) hashPolicy = parseInt(m[1]);
    } catch {}
  } else {
    hashPolicy = parseInt(hashMatch[1]);
  }

  const netDev = readProcNetDev();
  const now = Date.now();
  let zteRate = null, digiRate = null;
  if (prevNetDev && prevNetDevTime) {
    const dt = (now - prevNetDevTime) / 1000;
    const zPrev = prevNetDev[INTERFACES.zte.iface];
    const dPrev = prevNetDev[INTERFACES.digisol.iface];
    const zCur  = netDev[INTERFACES.zte.iface];
    const dCur  = netDev[INTERFACES.digisol.iface];
    if (zPrev && zCur) zteRate   = { rxRate: Math.max(0, (zCur.rxBytes - zPrev.rxBytes) / dt), txRate: Math.max(0, (zCur.txBytes - zPrev.txBytes) / dt) };
    if (dPrev && dCur) digiRate  = { rxRate: Math.max(0, (dCur.rxBytes - dPrev.rxBytes) / dt), txRate: Math.max(0, (dCur.txBytes - dPrev.txBytes) / dt) };
  }
  prevNetDev = netDev;
  prevNetDevTime = now;

  const zteIface  = netDev[INTERFACES.zte.iface]     || {};
  const digiIface = netDev[INTERFACES.digisol.iface] || {};

  return {
    zte: {
      interface: INTERFACES.zte.iface,
      ip: INTERFACES.zte.ip,
      gateway: INTERFACES.zte.gateway,
      status: zteLatency.value !== null ? 'up' : 'down',
      latency: zteLatency.value,
      rxBytes: zteIface.rxBytes || 0,
      txBytes: zteIface.txBytes || 0,
      ...(zteRate || {}),
    },
    digisol: {
      interface: INTERFACES.digisol.iface,
      ip: INTERFACES.digisol.ip,
      gateway: INTERFACES.digisol.gateway,
      status: digiLatency.value !== null ? 'up' : 'down',
      latency: digiLatency.value,
      rxBytes: digiIface.rxBytes || 0,
      txBytes: digiIface.txBytes || 0,
      ...(digiRate || {}),
    },
    mode,
    hashPolicy,
  };
}

// GET /api/wan/status
router.get('/status', async (req, res) => {
  try {
    const status = await getWanStatus();

    // Persist throughput snapshot (non-blocking)
    ThroughputSnapshot.create({
      zte:     { rxBytes: status.zte.rxBytes,     txBytes: status.zte.txBytes,     rxRate: status.zte.rxRate,     txRate: status.zte.txRate },
      digisol: { rxBytes: status.digisol.rxBytes, txBytes: status.digisol.txBytes, rxRate: status.digisol.rxRate, txRate: status.digisol.txRate },
    }).catch(() => {});

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// GET /api/wan/publicip
router.get('/publicip', async (req, res) => {
  const [zte, digisol] = await Promise.allSettled([
    getPublicIp(INTERFACES.zte.iface),
    getPublicIp(INTERFACES.digisol.iface),
  ]);
  res.json({
    zte:     zte.value     || null,
    digisol: digisol.value || null,
  });
});

// GET /api/wan/throughput
router.get('/throughput', async (req, res) => {
  try {
    const netDev = readProcNetDev();
    res.json({
      zte:     netDev[INTERFACES.zte.iface]     || null,
      digisol: netDev[INTERFACES.digisol.iface] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wan/throughput/history
router.get('/throughput/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 150, 300);
    const snapshots = await ThroughputSnapshot.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json(snapshots.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wan/latency
router.get('/latency', async (req, res) => {
  const [zte, digisol] = await Promise.allSettled([
    pingLatency(INTERFACES.zte.iface),
    curlLatency(INTERFACES.digisol.iface),
  ]);
  res.json({ zte: zte.value, digisol: digisol.value });
});

// GET /api/wan/status-timeline?hours=24
// Parses /var/log/wan-failover.log and returns per-WAN up/down segments
router.get('/status-timeline', (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168);
    res.json(parseStatusTimeline(hours));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
