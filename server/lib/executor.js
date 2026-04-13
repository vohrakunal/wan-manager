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
  'route-fix':          `ip rule flush && ip rule add from ${zte.ip} table zte && ip rule add from ${digisol.ip} table digisol && ip route flush cache`,

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
    const commandToRun = needsPrivilege ? `sudo -n ${cmd}` : cmd;

    exec(commandToRun, { timeout: 15000 }, async (err, stdout, stderr) => {
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
