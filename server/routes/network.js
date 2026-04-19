/**
 * GET /api/network/clients      — LAN devices with bandwidth (conntrack + DHCP)
 * GET /api/network/wan-sessions — Who is connected to local services (ss)
 */
const router = require('express').Router();
const { exec, execSync } = require('child_process');
const fs = require('fs');
const { NETWORK } = require('../lib/networkConfig');
const { parseLeases } = require('../lib/parser');

function execAsync(cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

// Keeps the previous counters to compute transfer rate deltas per client.
const lastClientCounters = new Map();

// ──────────────────────────────────────────────
// ARP table → discover live LAN devices
// ──────────────────────────────────────────────
function readArpTable() {
  try {
    const content = fs.readFileSync('/proc/net/arp', 'utf8');
    const lines = content.split('\n').slice(1);
    const devices = {};
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const ip = parts[0];
      const mac = parts[3];
      const iface = parts[5];
      if (mac === '00:00:00:00:00:00') continue;
      devices[ip] = { ip, mac: mac.toLowerCase(), iface };
    }
    return devices;
  } catch {
    return {};
  }
}

function parseConntrackLines(content, lanSubnet) {
  const byIp = {};

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    // Collect key=value tokens in order; reset direction grouping on src=
    const dirs = [];
    let cur = null;
    for (const m of line.matchAll(/(\w+)=([\d.]+)/g)) {
      const k = m[1];
      const v = m[2];
      if (k === 'src') {
        cur = { src: v };
        dirs.push(cur);
      } else if (cur) {
        if (k === 'dst') cur.dst = v;
        if (k === 'bytes') cur.bytes = parseInt(v, 10);
      }
    }

    // dirs[0] = original direction (LAN→remote), dirs[1] = reply (remote→LAN)
    if (dirs.length < 1) continue;
    const orig = dirs[0];
    const reply = dirs[1];

    // Credit bytes to the LAN IP
    if (orig.src && orig.src.startsWith(lanSubnet) && orig.bytes) {
      byIp[orig.src] = byIp[orig.src] || { txBytes: 0, rxBytes: 0 };
      byIp[orig.src].txBytes += orig.bytes;
    }
    if (reply && reply.dst && reply.dst.startsWith(lanSubnet) && reply.bytes) {
      byIp[reply.dst] = byIp[reply.dst] || { txBytes: 0, rxBytes: 0 };
      byIp[reply.dst].rxBytes += reply.bytes;
    }
  }

  return byIp;
}

function readConntrackCounters(lanSubnet) {
  const fileSources = ['/proc/net/nf_conntrack', '/proc/net/ip_conntrack'];

  for (const file of fileSources) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      return {
        byIp: parseConntrackLines(content, lanSubnet),
        available: true,
        source: file,
      };
    } catch {
      // try next source
    }
  }

  // Fallback: userspace conntrack tool (works on some systems where /proc files are hidden)
  try {
    const out = execSync('conntrack -L -o extended 2>/dev/null', {
      encoding: 'utf8',
      timeout: 6000,
      maxBuffer: 8 * 1024 * 1024,
    });

    return {
      byIp: parseConntrackLines(out, lanSubnet),
      available: true,
      source: 'conntrack-cli',
    };
  } catch {
    return { byIp: {}, available: false, source: 'none' };
  }
}

function computeRate(nowMs, ip, txBytes, rxBytes) {
  const prev = lastClientCounters.get(ip);
  let txRateBps = 0;
  let rxRateBps = 0;

  if (prev) {
    const dtSec = (nowMs - prev.tsMs) / 1000;
    if (dtSec > 0) {
      txRateBps = Math.max(0, (txBytes - prev.txBytes) / dtSec);
      rxRateBps = Math.max(0, (rxBytes - prev.rxBytes) / dtSec);
    }
  }

  return { txRateBps, rxRateBps, totalRateBps: txRateBps + rxRateBps };
}

// ──────────────────────────────────────────────
// GET /api/network/clients
// ──────────────────────────────────────────────
router.get('/clients', async (req, res) => {
  try {
    const lanIface = NETWORK.lan.iface;
    const lanSubnet = NETWORK.lan.ip.replace(/\.\d+$/, '.'); // e.g. "192.168.1."

    // 1. Live LAN devices from ARP
    const arpDevices = readArpTable();
    const lanDevices = Object.values(arpDevices).filter(d => d.iface === lanIface);

    // 2. DHCP leases → hostnames (also include devices seen in leases but not ARP)
    const leases = parseLeases();
    const leaseByMac = {};
    const leaseByIp = {};
    for (const l of leases) {
      leaseByMac[l.mac] = l;
      leaseByIp[l.ip] = l;
    }

    // 3. Per-IP byte totals from conntrack sources
    const { byIp: bwByIp, available, source } = readConntrackCounters(lanSubnet);

    // 4. Build client list — ARP devices (online now) enriched with DHCP + bw + rates
    const nowMs = Date.now();
    const nextClientCounters = new Map();

    const clients = lanDevices.map(d => {
      const lease = leaseByMac[d.mac] || leaseByIp[d.ip];
      const bw = bwByIp[d.ip] || { txBytes: 0, rxBytes: 0 };
      const rates = computeRate(nowMs, d.ip, bw.txBytes, bw.rxBytes);

      nextClientCounters.set(d.ip, {
        txBytes: bw.txBytes,
        rxBytes: bw.rxBytes,
        tsMs: nowMs,
      });

      return {
        ip: d.ip,
        mac: d.mac,
        hostname: lease?.hostname || null,
        status: 'online',
        txBytes: bw.txBytes,
        rxBytes: bw.rxBytes,
        totalBytes: bw.txBytes + bw.rxBytes,
        txRateBps: rates.txRateBps,
        rxRateBps: rates.rxRateBps,
        totalRateBps: rates.totalRateBps,
      };
    });

    // Update cache after building the response to avoid partial state on errors.
    lastClientCounters.clear();
    for (const [ip, state] of nextClientCounters.entries()) {
      lastClientCounters.set(ip, state);
    }

    clients.sort((a, b) => b.totalBytes - a.totalBytes);

    const hasData = clients.some(c => c.totalBytes > 0);
    const hasRateData = clients.some(c => c.totalRateBps > 0);

    res.json({
      clients,
      lanIface,
      lanIp: NETWORK.lan.ip,
      countersActive: hasData,
      ratesActive: hasRateData,
      nfConntrackAvailable: available,
      dataSource: source,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ──────────────────────────────────────────────
// Service definitions — port → label/category
// ──────────────────────────────────────────────
const SERVICE_PORTS = {
  22: { name: 'SSH', category: 'remote' },
  21: { name: 'FTP', category: 'remote' },
  20: { name: 'FTP-data', category: 'remote' },
  80: { name: 'HTTP', category: 'web' },
  443: { name: 'HTTPS', category: 'web' },
  8080: { name: 'HTTP-alt', category: 'web' },
  8443: { name: 'HTTPS-alt', category: 'web' },
  27017: { name: 'MongoDB', category: 'database' },
  5432: { name: 'PostgreSQL', category: 'database' },
  3306: { name: 'MySQL', category: 'database' },
  6379: { name: 'Redis', category: 'database' },
  3000: { name: 'Node/Dev', category: 'web' },
  5000: { name: 'App', category: 'web' },
  9000: { name: 'App', category: 'web' },
};

// ──────────────────────────────────────────────
// GET /api/network/wan-sessions
// Who is connected to THIS machine's services (via ss -Htnp)
// ──────────────────────────────────────────────
router.get('/wan-sessions', async (req, res) => {
  try {
    // -H = no header, -t = TCP, -n = numeric, -p = process
    // Use wide output so columns don't wrap
    const out = await execAsync('ss -Htnp state established 2>/dev/null', 8000);

    const leases = parseLeases();
    const hostnameByIp = {};
    for (const l of leases) if (l.hostname) hostnameByIp[l.ip] = l.hostname;

    const sessions = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;

      // Extract local and remote addr:port with a regex — immune to column shifting
      // ss line: ESTAB  0  0  LOCAL_ADDR:PORT  REMOTE_ADDR:PORT  users:(("proc",pid=N,fd=N))
      const m = line.match(
        /\s+(\d+)\s+(\d+)\s+([\d.]+):(\d+)\s+([\d.]+):(\d+)(?:\s+(.*))?$/
      );
      if (!m) continue;

      const localPort = parseInt(m[4], 10);
      const remoteIp = m[5];
      const remotePort = parseInt(m[6], 10);
      const procRaw = m[7] || '';

      const svc = SERVICE_PORTS[localPort];
      if (!svc) continue;

      // Extract process name from users:(("mongod",pid=123,fd=5))
      const procMatch = procRaw.match(/users:\(\("([^"]+)"/);
      const processName = procMatch ? procMatch[1] : null;

      sessions.push({
        service: svc.name,
        category: svc.category,
        localPort,
        remoteIp,
        remotePort,
        hostname: hostnameByIp[remoteIp] || null,
        process: processName,
        isLan: isPrivateIp(remoteIp),
      });
    }

    // Group by service for summary
    const byService = {};
    for (const s of sessions) {
      byService[s.service] = (byService[s.service] || 0) + 1;
    }

    res.json({
      sessions,
      byService,
      total: sessions.length,
      dataSource: 'ss',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    ip.startsWith('10.') ||
    ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
    ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') || ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') || ip.startsWith('172.25.') ||
    ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
    ip.startsWith('172.28.') || ip.startsWith('172.29.') ||
    ip.startsWith('172.30.') || ip.startsWith('172.31.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    ip === '::1'
  );
}

module.exports = router;
