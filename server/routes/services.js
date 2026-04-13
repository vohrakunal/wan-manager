/**
 * GET  /api/services          — list services with status
 * POST /api/services/:name/start
 * POST /api/services/:name/stop
 * POST /api/services/:name/restart
 *
 * Only services in ALLOWED_SERVICES may be controlled.
 * Critical system services are intentionally excluded.
 */
const router = require('express').Router();
const { exec } = require('child_process');
const ActionLog = require('../models/ActionLog');

// These are the manageable services.  Critical infrastructure (kmod, dbus,
// apparmor, ufw, ssh, cron, procps, unattended-upgrades) is excluded so
// an accidental click can't lock out the box.
const ALLOWED_SERVICES = [
  'nginx',
  'isc-dhcp-server',
  'openvpn',
  'iperf3',
  'docker',
  'fail2ban',
  'lldpd',
  'nmbd',
  'smbd',
  'unbound',
  'vnstat',
  'sysstat',
  'cups',
  'bluetooth',
  'rsync',
  'saned',
  'sssd',
  'speech-dispatcher',
];

const ALLOWED_SET = new Set(ALLOWED_SERVICES);

function execAsync(cmd, timeout = 15000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function getServiceStatus(name) {
  try {
    // `systemctl is-active` returns: active | inactive | failed | unknown
    const active = await execAsync(`systemctl is-active ${name} 2>/dev/null || true`);
    // `systemctl is-enabled` returns: enabled | disabled | static | masked | not-found
    let enabled = 'unknown';
    try { enabled = await execAsync(`systemctl is-enabled ${name} 2>/dev/null || true`); } catch {}
    return { name, active: active || 'unknown', enabled };
  } catch {
    return { name, active: 'unknown', enabled: 'unknown' };
  }
}

// GET /api/services
router.get('/', async (req, res) => {
  try {
    const statuses = await Promise.all(ALLOWED_SERVICES.map(getServiceStatus));
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/:name/:action
router.post('/:name/:action', async (req, res) => {
  const { name, action } = req.params;

  if (!ALLOWED_SET.has(name)) {
    return res.status(403).json({ error: `Service '${name}' is not in the allowed list` });
  }
  if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
    return res.status(400).json({ error: `Unknown action '${action}'` });
  }

  const cmd = `sudo systemctl ${action} ${name}`;
  const user = req.user?.username || 'api';

  try {
    const output = await execAsync(cmd, 20000);
    const status = await getServiceStatus(name);

    await ActionLog.create({
      action: `service:${action}:${name}`,
      user,
      success: true,
      output: output || `${action} ok`,
    }).catch(() => {});

    res.json({ success: true, output: output || `${action} ok`, status });
  } catch (err) {
    await ActionLog.create({
      action: `service:${action}:${name}`,
      user,
      success: false,
      output: String(err.message),
    }).catch(() => {});

    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
