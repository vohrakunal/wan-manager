/**
 * GET /api/network/clients      — LAN devices with bandwidth (conntrack + DHCP)
 * GET /api/network/wan-sessions — Who is connected to local services (ss)
 */
const router = require('express').Router();
const { exec, execSync } = require('child_process');
const fs = require('fs');
const { NETWORK } = require('../lib/networkConfig');
const { parseLeases } = require('../lib/parser');
const LanClientSnapshot = require('../models/LanClientSnapshot');

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

function isHostIpv4(ip) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip || '');
}

function addBytes(byIp, ip, field, bytes) {
  if (!isHostIpv4(ip) || !Number.isFinite(bytes) || bytes < 0) return;
  byIp[ip] = byIp[ip] || { txBytes: 0, rxBytes: 0 };
  byIp[ip][field] += bytes;
}

function runFirstAvailable(commands, opts) {
  for (const cmd of commands) {
    try {
      return execSync(cmd, opts);
    } catch {
      // try next command
    }
  }
  return null;
}

function readConntrackCounters(lanSubnet) {
  const fileSources = [
    '/proc/net/nf_conntrack',
    '/proc/net/ip_conntrack',
    '/proc/net/netfilter/nf_conntrack',
  ];

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
  const out = runFirstAvailable(
    [
      '/usr/sbin/conntrack -L -o extended 2>/dev/null',
      '/sbin/conntrack -L -o extended 2>/dev/null',
      'conntrack -L -o extended 2>/dev/null',
    ],
    {
      encoding: 'utf8',
      timeout: 6000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (out) {
    return {
      byIp: parseConntrackLines(out, lanSubnet),
      available: true,
      source: 'conntrack-cli',
    };
  }

  return { byIp: {}, available: false, source: 'none' };
}

function parseIptablesLines(content, lanSubnet) {
  const byIp = {};
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    const bytes = parseInt(m[2], 10);
    const src = m[3];
    const dst = m[4];
    if (src && src.startsWith(lanSubnet)) addBytes(byIp, src, 'txBytes', bytes);
    if (dst && dst.startsWith(lanSubnet)) addBytes(byIp, dst, 'rxBytes', bytes);
  }
  return byIp;
}

function readIptablesCounters(lanSubnet) {
  const cmds = [
    '/usr/sbin/iptables -w -t mangle -nvx -L FORWARD 2>/dev/null',
    '/usr/sbin/iptables -w -t filter -nvx -L FORWARD 2>/dev/null',
    '/usr/sbin/iptables-legacy -t mangle -nvx -L FORWARD 2>/dev/null',
    '/sbin/iptables -w -t mangle -nvx -L FORWARD 2>/dev/null',
    '/sbin/iptables -w -t filter -nvx -L FORWARD 2>/dev/null',
    '/sbin/iptables-legacy -t mangle -nvx -L FORWARD 2>/dev/null',
    'iptables -w -t mangle -nvx -L FORWARD 2>/dev/null',
    'iptables -w -t filter -nvx -L FORWARD 2>/dev/null',
    'iptables-legacy -t mangle -nvx -L FORWARD 2>/dev/null',
  ];

  const merged = {};
  let readable = false;

  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, {
        encoding: 'utf8',
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024,
      });
      readable = true;
      const part = parseIptablesLines(out, lanSubnet);
      for (const [ip, bw] of Object.entries(part)) {
        merged[ip] = merged[ip] || { txBytes: 0, rxBytes: 0 };
        merged[ip].txBytes += bw.txBytes || 0;
        merged[ip].rxBytes += bw.rxBytes || 0;
      }
    } catch {
      // keep trying other variants
    }
  }

  const available = readable && Object.keys(merged).length > 0;
  return { byIp: merged, available, source: available ? 'iptables' : 'none' };
}

function parseNftRulesetCounters(content, lanSubnet) {
  const byIp = {};
  for (const line of content.split('\n')) {
    if (!line.includes('counter') || !line.includes('bytes')) continue;

    const tx = line.match(/ip saddr (\d+\.\d+\.\d+\.\d+).*counter packets \d+ bytes (\d+)/);
    if (tx && tx[1].startsWith(lanSubnet)) addBytes(byIp, tx[1], 'txBytes', parseInt(tx[2], 10));

    const rx = line.match(/ip daddr (\d+\.\d+\.\d+\.\d+).*counter packets \d+ bytes (\d+)/);
    if (rx && rx[1].startsWith(lanSubnet)) addBytes(byIp, rx[1], 'rxBytes', parseInt(rx[2], 10));
  }
  return byIp;
}

function readNftablesCounters(lanSubnet) {
  const out = runFirstAvailable(
    [
      '/usr/sbin/nft list ruleset -a 2>/dev/null',
      '/sbin/nft list ruleset -a 2>/dev/null',
      'nft list ruleset -a 2>/dev/null',
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );

  if (out) {
    const byIp = parseNftRulesetCounters(out, lanSubnet);
    const available = Object.keys(byIp).length > 0;
    return { byIp, available, source: available ? 'nftables' : 'none' };
  }

  return { byIp: {}, available: false, source: 'none' };
}

function readLanCounters(lanSubnet) {
  const conntrack = readConntrackCounters(lanSubnet);
  if (conntrack.available) return conntrack;

  const iptables = readIptablesCounters(lanSubnet);
  if (iptables.available) return iptables;

  const nft = readNftablesCounters(lanSubnet);
  if (nft.available) return nft;

  return { byIp: {}, available: false, source: 'none' };
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

function persistLanSnapshot({ nowMs, lanIface, lanIp, dataSource, countersAvailable, clients }) {
  const bucketStart = new Date(Math.floor(nowMs / 60000) * 60000);
  const lastSampleAt = new Date(nowMs);

  const compactClients = clients.map(c => ({
    ip: c.ip,
    mac: c.mac,
    hostname: c.hostname || null,
    txBytes: c.txBytes || 0,
    rxBytes: c.rxBytes || 0,
    totalBytes: c.totalBytes || 0,
    txRateBps: c.txRateBps || 0,
    rxRateBps: c.rxRateBps || 0,
    totalRateBps: c.totalRateBps || 0,
  }));

  return LanClientSnapshot.findOneAndUpdate(
    { bucketStart, lanIface },
    {
      $set: {
        lanIp,
        dataSource,
        countersAvailable,
        lastSampleAt,
        clients: compactClients,
      },
      $inc: { sampleCount: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).exec();
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

    // 3. Per-IP byte totals from available accounting source
    const { byIp: bwByIp, available, source } = readLanCounters(lanSubnet);

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
    const timestamp = new Date().toISOString();

    // Persist minute-bucket snapshot (non-blocking)
    persistLanSnapshot({
      nowMs,
      lanIface,
      lanIp: NETWORK.lan.ip,
      dataSource: source,
      countersAvailable: available,
      clients,
    }).catch(() => {});

    res.json({
      clients,
      lanIface,
      lanIp: NETWORK.lan.ip,
      countersActive: hasData,
      ratesActive: hasRateData,
      nfConntrackAvailable: available,
      dataSource: source,
      timestamp,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Reset in-memory LAN rate cache (useful for manual recalibration/testing)
router.post('/clients/reset', (req, res) => {
  lastClientCounters.clear();
  res.json({ success: true, message: 'LAN client rate cache cleared' });
});

// GET /api/network/clients/history
// Minute-bucketed snapshots from MongoDB
router.get('/clients/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 180, 1440);
    const snapshots = await LanClientSnapshot.find({ lanIface: NETWORK.lan.iface })
      .sort({ bucketStart: -1 })
      .limit(limit)
      .lean();
    res.json(snapshots.reverse());
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
