const { exec } = require('child_process');
const fs = require('fs');
const ActionLog = require('../models/ActionLog');

// Whitelist of allowed commands — no user input ever reaches shell
const ALLOWED_COMMANDS = {
  // WAN health checks
  'wan-ping-zte':       'ping -I eno1 -c 3 -W 2 8.8.8.8',
  'wan-ping-digi':      'curl --interface enx207bd51a8b0b -s --max-time 5 -o /dev/null -w "%{time_total}" http://1.1.1.1',
  'wan-publicip-zte':   'curl --interface eno1 -s --max-time 5 https://ifconfig.io',
  'wan-publicip-digi':  'curl --interface enx207bd51a8b0b -s --max-time 5 https://ifconfig.io',

  // Routing
  'route-default':      'ip route show default',
  'route-main':         'ip route show table main',
  'route-zte':          'ip route show table zte',
  'route-digisol':      'ip route show table digisol',
  'rule-list':          'ip rule list',
  'link-stats':         'ip -s link show',

  // Failover actions
  'set-ecmp':           'ip route replace default nexthop via 192.168.20.1 dev eno1 weight 1 nexthop via 192.168.10.1 dev enx207bd51a8b0b weight 1',
  'set-zte-only':       'ip route replace default via 192.168.20.1 dev eno1',
  'set-digisol-only':   'ip route replace default via 192.168.10.1 dev enx207bd51a8b0b',
  'run-setup':          '/usr/local/bin/wan-setup.sh',
  'route-fix':          'ip rule flush && ip rule add from 192.168.20.75 table zte && ip rule add from 192.168.10.75 table digisol && ip route flush cache',

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

    exec(`sudo ${cmd}`, { timeout: 15000 }, async (err, stdout, stderr) => {
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
  return new Promise((resolve, reject) => {
    exec(`sudo sysctl -w net.ipv4.fib_multipath_hash_policy=${val}`, { timeout: 5000 }, async (err, stdout) => {
      try {
        await ActionLog.create({ action: 'set-hash-policy', user: opts.user || 'system', note: `policy=${val}`, output: stdout, success: !err });
      } catch (_) {}
      if (err) return reject(err.message);
      resolve(stdout.trim());
    });
  });
}

module.exports = { runCommand, setHashPolicy, ALLOWED_COMMANDS };
