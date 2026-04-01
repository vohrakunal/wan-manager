const fs = require('fs');

/**
 * Parse /var/lib/dhcp/dhcpd.leases into an array of lease objects.
 */
function parseLeases(filePath = '/var/lib/dhcp/dhcpd.leases') {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const leases = [];
  const blocks = content.split(/^lease\s/m).slice(1);

  for (const block of blocks) {
    const ip      = block.match(/^(\S+)/)?.[1];
    const mac     = block.match(/hardware ethernet\s+([0-9a-f:]+)/i)?.[1];
    const host    = block.match(/client-hostname\s+"([^"]+)"/i)?.[1] || '';
    const start   = block.match(/starts\s+\d+\s+([^;]+)/i)?.[1]?.trim();
    const end     = block.match(/ends\s+\d+\s+([^;]+)/i)?.[1]?.trim();
    const state   = block.match(/binding state\s+(\w+)/i)?.[1] || 'unknown';

    if (ip && mac) {
      leases.push({
        ip,
        mac: mac.toLowerCase(),
        hostname: host,
        start: start ? new Date(start).toISOString() : null,
        end:   end   ? new Date(end).toISOString()   : null,
        status: state,
        isStatic: false, // filled in by cross-reference
      });
    }
  }
  return leases;
}

/**
 * Parse static reservations (host blocks) from /etc/dhcp/dhcpd.conf
 */
function parseReservations(filePath = '/etc/dhcp/dhcpd.conf') {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const reservations = [];
  const blocks = content.split(/^host\s+/m).slice(1);

  for (const block of blocks) {
    const name    = block.match(/^(\S+)/)?.[1];
    const mac     = block.match(/hardware ethernet\s+([0-9a-f:]+)/i)?.[1];
    const ip      = block.match(/fixed-address\s+([0-9.]+)/i)?.[1];

    if (mac && ip) {
      reservations.push({ name: name || '', mac: mac.toLowerCase(), ip });
    }
  }
  return reservations;
}

/**
 * Add a static reservation to dhcpd.conf
 */
function addReservation(filePath = '/etc/dhcp/dhcpd.conf', { mac, ip, hostname }) {
  const safeMac  = mac.replace(/[^0-9a-f:]/gi, '');
  const safeIp   = ip.replace(/[^0-9.]/g, '');
  const safeName = hostname.replace(/[^a-zA-Z0-9-]/g, '') || `host-${safeMac.replace(/:/g, '')}`;

  const block = `\nhost ${safeName} {\n  hardware ethernet ${safeMac};\n  fixed-address ${safeIp};\n}\n`;
  fs.appendFileSync(filePath, block, 'utf8');
}

/**
 * Remove a static reservation from dhcpd.conf by MAC address
 */
function removeReservation(filePath = '/etc/dhcp/dhcpd.conf', mac) {
  const safeMac = mac.replace(/[^0-9a-f:]/gi, '').toLowerCase();
  let content = fs.readFileSync(filePath, 'utf8');
  // Remove the host block containing this MAC
  content = content.replace(
    new RegExp(`\\nhost\\s+\\S+\\s*\\{[^}]*hardware ethernet\\s+${safeMac.replace(/:/g, ':')}[^}]*\\}`, 'gi'),
    ''
  );
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Read /proc/net/dev and return per-interface TX/RX bytes
 */
function readProcNetDev() {
  const content = fs.readFileSync('/proc/net/dev', 'utf8');
  const lines = content.split('\n').slice(2); // skip headers
  const result = {};
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 17) continue;
    const iface = parts[0].replace(':', '');
    result[iface] = {
      rxBytes:  parseInt(parts[1], 10),
      rxPackets: parseInt(parts[2], 10),
      txBytes:  parseInt(parts[9], 10),
      txPackets: parseInt(parts[10], 10),
    };
  }
  return result;
}

module.exports = { parseLeases, parseReservations, addReservation, removeReservation, readProcNetDev };
