/**
 * GET /api/network/clients        — LAN devices with bandwidth usage
 * GET /api/network/wan-sessions   — Active WAN (internet) connections
 * POST /api/network/clients/reset — Reset iptables byte counters
 */
const router = require('express').Router();
const { exec } = require('child_process');
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

// ──────────────────────────────────────────────
// ARP table → discover LAN devices
// ──────────────────────────────────────────────
function readArpTable() {
  try {
    const content = fs.readFileSync('/proc/net/arp', 'utf8');
    const lines = content.split('\n').slice(1); // skip header
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
// iptables accounting — ensure chains exist and
// add a rule per LAN client if not already there
// ──────────────────────────────────────────────
const CHAIN = 'NMT_BW';

async function ensureIptablesChain(lanIface) {
  try {
    // Create chain if missing
    await execAsync(`iptables -N ${CHAIN} 2>/dev/null; true`);
    // Hook into FORWARD if not already
    const rules = await execAsync(`iptables -C FORWARD -i ${lanIface} -j ${CHAIN} 2>&1`).catch(() => 'missing');
    if (rules.includes('missing') || rules.includes('No chain')) {
      await execAsync(`iptables -I FORWARD 1 -i ${lanIface} -j ${CHAIN}`);
    }
    const rulesOut = await execAsync(`iptables -C FORWARD -o ${lanIface} -j ${CHAIN} 2>&1`).catch(() => 'missing');
    if (rulesOut.includes('missing') || rulesOut.includes('No chain')) {
      await execAsync(`iptables -I FORWARD 2 -o ${lanIface} -j ${CHAIN}`);
    }
  } catch {
    // non-fatal — may not have iptables
  }
}

async function ensureIptablesRule(ip) {
  try {
    // source rule (upload from device)
    const chk1 = await execAsync(`iptables -C ${CHAIN} -s ${ip} 2>&1`).catch(() => 'missing');
    if (chk1.includes('missing') || chk1.includes('No chain') || chk1.includes('does a matching')) {
      await execAsync(`iptables -A ${CHAIN} -s ${ip}`);
    }
    // destination rule (download to device)
    const chk2 = await execAsync(`iptables -C ${CHAIN} -d ${ip} 2>&1`).catch(() => 'missing');
    if (chk2.includes('missing') || chk2.includes('No chain') || chk2.includes('does a matching')) {
      await execAsync(`iptables -A ${CHAIN} -d ${ip}`);
    }
  } catch {
    // non-fatal
  }
}

// Parse iptables -L NMT_BW -v -n --line-numbers output
async function readIptablesBandwidth() {
  try {
    const out = await execAsync(`iptables -L ${CHAIN} -v -n -x`, 5000);
    const lines = out.split('\n').slice(2); // skip chain header + column header
    const byIp = {};
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;
      const bytes = parseInt(parts[1], 10);
      // source IP is in parts[7], dest IP in parts[8]
      const src = parts[7];
      const dst = parts[8];
      if (src && src !== '0.0.0.0/0' && !src.includes('/')) {
        byIp[src] = (byIp[src] || { txBytes: 0, rxBytes: 0 });
        byIp[src].txBytes += bytes;
      }
      if (dst && dst !== '0.0.0.0/0' && !dst.includes('/')) {
        byIp[dst] = (byIp[dst] || { txBytes: 0, rxBytes: 0 });
        byIp[dst].rxBytes += bytes;
      }
    }
    return byIp;
  } catch {
    return {};
  }
}

// ──────────────────────────────────────────────
// GET /api/network/clients
// ──────────────────────────────────────────────
router.get('/clients', async (req, res) => {
  try {
    const lanIface = NETWORK.lan.iface;

    // Ensure iptables chain is wired up (idempotent)
    await ensureIptablesChain(lanIface);

    // Read ARP table for live LAN devices
    const arpDevices = readArpTable();

    // Filter to LAN interface only
    const lanDevices = Object.values(arpDevices).filter(d => d.iface === lanIface);

    // Ensure iptables rules exist for each device
    await Promise.allSettled(lanDevices.map(d => ensureIptablesRule(d.ip)));

    // Read DHCP leases for hostnames
    const leases = parseLeases();
    const leaseByMac = {};
    const leaseByIp  = {};
    for (const l of leases) {
      leaseByMac[l.mac] = l;
      leaseByIp[l.ip]   = l;
    }

    // Read iptables bandwidth counters
    const bwByIp = await readIptablesBandwidth();

    // Build client list
    const clients = lanDevices.map(d => {
      const lease    = leaseByMac[d.mac] || leaseByIp[d.ip];
      const bw       = bwByIp[d.ip] || { txBytes: 0, rxBytes: 0 };
      return {
        ip:       d.ip,
        mac:      d.mac,
        hostname: lease?.hostname || null,
        status:   'online',  // in ARP = recently active
        txBytes:  bw.txBytes,
        rxBytes:  bw.rxBytes,
        totalBytes: bw.txBytes + bw.rxBytes,
      };
    });

    // Sort by total bytes desc
    clients.sort((a, b) => b.totalBytes - a.totalBytes);

    res.json({
      clients,
      lanIface,
      lanIp: NETWORK.lan.ip,
      countersActive: Object.keys(bwByIp).length > 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ──────────────────────────────────────────────
// POST /api/network/clients/reset
// Reset iptables byte counters (flush + re-add rules)
// ──────────────────────────────────────────────
router.post('/clients/reset', async (req, res) => {
  try {
    await execAsync(`iptables -Z ${CHAIN}`);
    res.json({ ok: true, message: 'Bandwidth counters reset' });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ──────────────────────────────────────────────
// GET /api/network/wan-sessions
// Active external (WAN) connections passing through this router
// ──────────────────────────────────────────────
router.get('/wan-sessions', async (req, res) => {
  try {
    // Use conntrack if available, fallback to ss
    let sessions = [];

    try {
      // conntrack gives us the richest info: src, dst, bytes, state
      const out = await execAsync(
        `conntrack -L -p tcp --state ESTABLISHED 2>/dev/null | head -200`,
        8000
      );
      sessions = parseConntrack(out);
    } catch {
      // conntrack not available — fall back to ss
      try {
        const out = await execAsync(`ss -tnp state established 2>/dev/null | tail -n +2`, 5000);
        sessions = parseSsOutput(out);
      } catch {
        sessions = [];
      }
    }

    // Tag each session: which WAN IP is the source/origin?
    const wanIps = new Set([NETWORK.zte.ip, NETWORK.digisol.ip]);
    const lanSubnet = NETWORK.lan.ip.replace(/\.\d+$/, '.'); // e.g. "192.168.1."

    // Filter to sessions that have at least one WAN-side endpoint
    // and one LAN-side endpoint (routed traffic)
    const wanSessions = sessions.filter(s => {
      const hasWan = wanIps.has(s.srcIp) || wanIps.has(s.dstIp);
      const hasLan = s.srcIp.startsWith(lanSubnet) || s.dstIp.startsWith(lanSubnet);
      // Also include sessions from LAN to internet (no WAN IP match needed — just non-RFC1918 dst)
      const dstIsPublic = !isPrivateIp(s.dstIp);
      const srcIsLan    = s.srcIp.startsWith(lanSubnet);
      return hasWan || (srcIsLan && dstIsPublic) || (hasLan && hasWan);
    });

    // If conntrack failed, show all established external connections
    const result = wanSessions.length > 0 ? wanSessions : sessions.filter(s => {
      return !isPrivateIp(s.dstIp) || !isPrivateIp(s.srcIp);
    });

    // Read DHCP leases for hostname lookup
    const leases = parseLeases();
    const hostnameByIp = {};
    for (const l of leases) {
      if (l.hostname) hostnameByIp[l.ip] = l.hostname;
    }

    const enriched = result.map(s => ({
      ...s,
      srcHostname: hostnameByIp[s.srcIp] || null,
      dstHostname: hostnameByIp[s.dstIp] || null,
      wan: wanIps.has(s.srcIp) ? (s.srcIp === NETWORK.zte.ip ? 'ZTE' : 'DIGISOL')
         : wanIps.has(s.dstIp) ? (s.dstIp === NETWORK.zte.ip ? 'ZTE' : 'DIGISOL')
         : 'unknown',
    }));

    res.json({
      sessions: enriched,
      total: enriched.length,
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
 * Parse `conntrack -L -p tcp --state ESTABLISHED` output
 * Example line:
 * tcp      6 431995 ESTABLISHED src=192.168.1.5 dst=142.250.80.46 sport=52100 dport=443 ...
 */
function parseConntrack(out) {
  const sessions = [];
  for (const line of out.split('\n')) {
    if (!line.includes('ESTABLISHED')) continue;
    const src   = line.match(/src=([\d.]+)/)?.[1];
    const dst   = line.match(/dst=([\d.]+)/)?.[1];
    const sport = line.match(/sport=(\d+)/)?.[1];
    const dport = line.match(/dport=(\d+)/)?.[1];
    const bytes = line.match(/bytes=(\d+)/)?.[1];
    const proto = line.match(/^(\w+)/)?.[1] || 'tcp';
    if (src && dst) {
      sessions.push({
        proto:   proto.toLowerCase(),
        srcIp:   src,
        srcPort: sport ? parseInt(sport) : null,
        dstIp:   dst,
        dstPort: dport ? parseInt(dport) : null,
        bytes:   bytes ? parseInt(bytes) : null,
        state:   'ESTABLISHED',
      });
    }
  }
  return sessions;
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
