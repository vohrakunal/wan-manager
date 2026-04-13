const { exec } = require('child_process');
const fs = require('fs');
const ActionLog = require('../models/ActionLog');
const { NETWORK } = require('./networkConfig');

const zte = NETWORK.zte;
const digisol = NETWORK.digisol;

const PRIVILEGED_COMMANDS = new Set([
  'set-ecmp',
  'set-zte-only',
  'set-digisol-only',
  'run-setup',
  'route-fix',
  'restart-dhcp',
  'restart-wan-routes',
]);

// Whitelist of allowed commands — no user input ever reaches shell
const ALLOWED_COMMANDS = {
  // WAN health checks
  'wan-ping-zte':       `ping -I ${zte.iface} -c 3 -W 2 8.8.8.8`,
  'wan-ping-digi':      `curl --interface ${digisol.iface} -s --max-time 5 -o /dev/null -w "%{time_total}" http://1.1.1.1`,
  'wan-publicip-zte':   `curl --interface ${zte.iface} -s --max-time 5 https://ifconfig.io`,
  'wan-publicip-digi':  `curl --interface ${digisol.iface} -s --max-time 5 https://ifconfig.io`,

  // Routing
  'route-default':      'ip route show default',
  'route-main':         'ip route show table main',
  'route-zte':          'ip route show table zte',
  'route-digisol':      'ip route show table digisol',
  'rule-list':          'ip rule list',
  'link-stats':         'ip -s link show',

  // Failover actions
  'set-ecmp':           `ip route replace default nexthop via ${zte.gateway} dev ${zte.iface} weight 1 nexthop via ${digisol.gateway} dev ${digisol.iface} weight 1`,
  'set-zte-only':       `ip route replace default via ${zte.gateway} dev ${zte.iface}`,
  'set-digisol-only':   `ip route replace default via ${digisol.gateway} dev ${digisol.iface}`,
  'run-setup':          '/usr/local/bin/wan-setup.sh',

  // Safe duplicate-rule cleanup — removes ONLY the WAN-specific rules using
  // a while loop (like wan-setup.sh does). NEVER uses ip rule flush, which
  // would destroy the system local/main/default rules and break all routing.
  'route-fix': [
    // Remove duplicate ZTE rules (loop until none left)
    `while ip rule del from ${zte.ip} table zte 2>/dev/null; do true; done`,
    // Remove duplicate DIGISOL rules (loop until none left)
    `while ip rule del from ${digisol.ip} table digisol 2>/dev/null; do true; done`,
    // Re-add exactly one of each with correct priority
    `ip rule add from ${zte.ip} table zte priority 100`,
    `ip rule add from ${digisol.ip} table digisol priority 100`,
    // Fix ZTE policy table routes
    `ip route flush table zte`,
    `ip route add default via ${zte.gateway} dev ${zte.iface} table zte`,
    `ip route add ${zte.ip.replace(/\.\d+$/, '.0')}/24 dev ${zte.iface} src ${zte.ip} table zte`,
    // Fix DIGISOL policy table routes
    `ip route flush table digisol`,
    `ip route add default via ${digisol.gateway} dev ${digisol.iface} table digisol`,
    `ip route add ${digisol.ip.replace(/\.\d+$/, '.0')}/24 dev ${digisol.iface} src ${digisol.ip} table digisol`,
    // Restore ECMP default route
    `ip route replace default nexthop via ${zte.gateway} dev ${zte.iface} weight 1 nexthop via ${digisol.gateway} dev ${digisol.iface} weight 1`,
    // Flush route cache
    `ip route flush cache`,
  ].join(' && '),

  // Services
  'restart-dhcp':       'systemctl restart isc-dhcp-server',
  'restart-wan-routes': 'systemctl restart wan-routes.service',

  // Hash policy — value is substituted safely (must be 0 or 1)
  // handled separately in setHashPolicy()
};

function runCommand(key, { user = 'system', note = '' } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = ALLOWED_COMMANDS[key];
    if (!cmd) return reject(new Error(`Command key '${key}' not allowed`));

    const needsPrivilege = PRIVILEGED_COMMANDS.has(key);
    // route-fix uses shell builtins (while loop) so must run inside bash -c
    const commandToRun = key === 'route-fix'
      ? `sudo -n bash -c ${JSON.stringify(cmd)}`
      : needsPrivilege ? `sudo -n ${cmd}` : cmd;

    exec(commandToRun, { timeout: key === 'route-fix' ? 30000 : 15000 }, async (err, stdout, stderr) => {
      const output = stdout ? stdout.trim() : '';
      const error  = stderr ? stderr.trim() : '';

      // Persist action log (non-blocking)
      try {
        await ActionLog.create({ action: key, user, note, output: output || error, success: !err });
      } catch (_) {}

      // Append to file log
      const line = `[${new Date().toISOString()}] ${user} ran '${key}': ${err ? 'FAILED' : 'OK'}${note ? ' | ' + note : ''}\n`;
      fs.appendFile('/var/log/wan-manager.log', line, () => {});

      if (err) return reject(error || err.message);
      resolve(output);
    });
  });
}

function setHashPolicy(policy, opts = {}) {
  const val = policy === 0 ? '0' : '1';
  const candidates = ['/usr/sbin/sysctl', '/usr/bin/sysctl', '/sbin/sysctl'];

  return new Promise((resolve, reject) => {
    let idx = 0;

    const tryNext = () => {
      if (idx >= candidates.length) {
        return reject('sudo: a password is required or sysctl path is not permitted in sudoers');
      }

      const sysctlPath = candidates[idx++];
      exec(`sudo -n ${sysctlPath} -w net.ipv4.fib_multipath_hash_policy=${val}`, { timeout: 5000 }, async (err, stdout, stderr) => {
        const output = (stdout || '').trim();
        const error = (stderr || err?.message || '').trim();

        if (err) {
          return tryNext();
        }

        try {
          await ActionLog.create({ action: 'set-hash-policy', user: opts.user || 'system', note: `policy=${val}`, output, success: true });
        } catch (_) {}
        resolve(output);
      });
    };

    tryNext();
  });
}

module.exports = { runCommand, setHashPolicy, ALLOWED_COMMANDS };
