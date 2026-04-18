/**
 * GET /api/network/clients        — LAN devices with bandwidth usage (from conntrack)
 * GET /api/network/wan-sessions   — Active WAN (internet) connections
 */
const router = require('express').Router();
const { exec } = require('child_process');
const fs = require('fs');
const { NETWORK } = require('../lib/networkConfig');
const { parseLeases } = require('../lib/parser');

function execAsync(cmd, timeout = 15000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

// ──────────────────────────────────────────────
// ARP table → discover LAN devices
// ──────────────────────────────────────────────
function readArpTable() {
  try {
    const content = fs.readFileSync('/proc/net/arp', 'utf8');
    const lines = content.split('\n').slice(1);
    const devices = {};
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const ip    = parts[0];
      const mac   = parts[3];
      const iface = parts[5];
      if (mac === '00:00:00:00:00:00') continue;
      devices[ip] = { ip, mac: mac.toLowerCase(), iface };
    }
    return devices;
  } catch {
    return {};
  }
}

// ──────────────────────────────────────────────
// conntrack → per-LAN-IP byte totals
// conntrack -L dumps all tracked connections with byte counters.
// Each line has two directions; we attribute:
//   src=<LAN-IP> ... → txBytes (device sent)
//   dst=<LAN-IP> ... → rxBytes (device received)
// ──────────────────────────────────────────────
async function getBandwidthFromConntrack(lanSubnet) {
  const byIp = {};

  try {
    // conntrack -L outputs all protocols; -o extended gives byte/packet counts
    const out = await execAsync('conntrack -L -o extended 2>/dev/null', 12000);
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;

      // Each conntrack line has two directions separated by a blank-ish boundary.
      // Pattern: src=X dst=Y sport=A dport=B packets=N bytes=M [UNREPLIED] src=Y dst=X ...
      // We parse all src=/dst=/bytes= tokens in order.
      const tokens = line.matchAll(/(\w+)=([\d.:a-fA-F]+)/g);
      const pairs = [];
      for (const m of tokens) pairs.push({ k: m[1], v: m[2] });

      // Walk through key=value pairs and collect (src, dst, bytes) tuples per direction
      let curSrc = null, curDst = null;
      for (const { k, v } of pairs) {
        if (k === 'src') curSrc = v;
        else if (k === 'dst') curDst = v;
        else if (k === 'bytes') {
          const b = parseInt(v, 10);
          if (curSrc && curSrc.startsWith(lanSubnet)) {
            byIp[curSrc] = byIp[curSrc] || { txBytes: 0, rxBytes: 0 };
            byIp[curSrc].txBytes += b;
          }
          if (curDst && curDst.startsWith(lanSubnet)) {
            byIp[curDst] = byIp[curDst] || { txBytes: 0, rxBytes: 0 };
            byIp[curDst].rxBytes += b;
          }
          // reset for next direction pair
          curSrc = null; curDst = null;
        }
      }
    }
  } catch {
    // conntrack not available or failed — return empty (UI shows 0 B gracefully)
  }

  return byIp;
}

// ──────────────────────────────────────────────
// GET /api/network/clients
// ──────────────────────────────────────────────
router.get('/clients', async (req, res) => {
  try {
    const lanIface = NETWORK.lan.iface;
    const lanSubnet = NETWORK.lan.ip.replace(/\.\d+$/, '.'); // e.g. "192.168.1."

    // ARP table for live LAN devices
    const arpDevices = readArpTable();
    const lanDevices = Object.values(arpDevices).filter(d => d.iface === lanIface);

    // DHCP leases for hostnames
    const leases = parseLeases();
    const leaseByMac = {};
    const leaseByIp  = {};
    for (const l of leases) {
      leaseByMac[l.mac] = l;
      leaseByIp[l.ip]   = l;
    }

    // conntrack byte totals per IP — immediate, no warm-up needed
    const bwByIp = await getBandwidthFromConntrack(lanSubnet);

    const clients = lanDevices.map(d => {
      const lease = leaseByMac[d.mac] || leaseByIp[d.ip];
      const bw    = bwByIp[d.ip] || { txBytes: 0, rxBytes: 0 };
      return {
        ip:         d.ip,
        mac:        d.mac,
        hostname:   lease?.hostname || null,
        status:     'online',
        txBytes:    bw.txBytes,
        rxBytes:    bw.rxBytes,
        totalBytes: bw.txBytes + bw.rxBytes,
      };
    });

    clients.sort((a, b) => b.totalBytes - a.totalBytes);

    res.json({
      clients,
      lanIface,
      lanIp: NETWORK.lan.ip,
      countersActive: Object.keys(bwByIp).length > 0,
      dataSource: 'conntrack',
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
  22:    { name: 'SSH',       category: 'remote' },
  21:    { name: 'FTP',       category: 'remote' },
  20:    { name: 'FTP-data',  category: 'remote' },
  80:    { name: 'HTTP',      category: 'web' },
  443:   { name: 'HTTPS',     category: 'web' },
  8080:  { name: 'HTTP-alt',  category: 'web' },
  8443:  { name: 'HTTPS-alt', category: 'web' },
  27017: { name: 'MongoDB',   category: 'database' },
  5432:  { name: 'PostgreSQL',category: 'database' },
  3306:  { name: 'MySQL',     category: 'database' },
  6379:  { name: 'Redis',     category: 'database' },
  3000:  { name: 'Node/Dev',  category: 'web' },
  5000:  { name: 'App',       category: 'web' },
  9000:  { name: 'App',       category: 'web' },
};

// ──────────────────────────────────────────────
// GET /api/network/wan-sessions
// Who is connected to THIS machine's services (via ss -tnp)
// ──────────────────────────────────────────────
router.get('/wan-sessions', async (req, res) => {
  try {
    // ss -tnp: TCP, numeric, with process info
    // We look at ESTAB connections where the LOCAL port matches a known service
    const out = await execAsync('ss -tnp state established 2>/dev/null', 8000);

    const leases = parseLeases();
    const hostnameByIp = {};
    for (const l of leases) if (l.hostname) hostnameByIp[l.ip] = l.hostname;

    const sessions = [];
    for (const line of out.split('\n').slice(1)) { // skip header
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      // ss -tnp columns: State Recv-Q Send-Q Local Remote [Process]
      const local  = parts[3];
      const remote = parts[4];
      const proc   = parts.slice(5).join(' ') || '';

      const [localIp,  localPort]  = splitHostPort(local);
      const [remoteIp, remotePort] = splitHostPort(remote);

      if (!localIp || !remoteIp || !localPort) continue;

      const lport = parseInt(localPort);
      const rport = parseInt(remotePort);

      // Only include connections where the LOCAL side is a known service port
      const svc = SERVICE_PORTS[lport];
      if (!svc) continue;

      // Extract process name from "users:(("nginx",pid=123,fd=5))"
      const procMatch = proc.match(/users:\(\("([^"]+)"/);
      const processName = procMatch ? procMatch[1] : null;

      sessions.push({
        service:     svc.name,
        category:    svc.category,
        localPort:   lport,
        remoteIp,
        remotePort:  rport,
        hostname:    hostnameByIp[remoteIp] || null,
        process:     processName,
        isLan:       !isPrivateIp(remoteIp) ? false : true,
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
    ip.startsWith('10.')        ||
    ip.startsWith('172.16.')    || ip.startsWith('172.17.')  ||
    ip.startsWith('172.18.')    || ip.startsWith('172.19.')  ||
    ip.startsWith('172.20.')    || ip.startsWith('172.21.')  ||
    ip.startsWith('172.22.')    || ip.startsWith('172.23.')  ||
    ip.startsWith('172.24.')    || ip.startsWith('172.25.')  ||
    ip.startsWith('172.26.')    || ip.startsWith('172.27.')  ||
    ip.startsWith('172.28.')    || ip.startsWith('172.29.')  ||
    ip.startsWith('172.30.')    || ip.startsWith('172.31.')  ||
    ip.startsWith('192.168.')   ||
    ip.startsWith('127.')       ||
    ip === '::1'
  );
}

/**
 * Parse `ss -tnp state established` output
 * Example: ESTAB 0 0 192.168.1.5:52100 142.250.80.46:443 ...
 */
function parseSsOutput(out) {
  const sessions = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local  = parts[3];
    const remote = parts[4];
    const [srcIp, srcPort]  = splitHostPort(local);
    const [dstIp, dstPort]  = splitHostPort(remote);
    if (srcIp && dstIp) {
      sessions.push({
        proto:   'tcp',
        srcIp,
        srcPort: srcPort ? parseInt(srcPort) : null,
        dstIp,
        dstPort: dstPort ? parseInt(dstPort) : null,
        bytes:   null,
        state:   'ESTABLISHED',
      });
    }
  }
  return sessions;
}

function splitHostPort(hostport) {
  if (!hostport) return [null, null];
  const last = hostport.lastIndexOf(':');
  if (last < 0) return [hostport, null];
  return [hostport.slice(0, last), hostport.slice(last + 1)];
}

module.exports = router;
