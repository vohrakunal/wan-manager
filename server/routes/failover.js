const router = require('express').Router();
const { runCommand, setHashPolicy } = require('../lib/executor');

function withUser(req) {
  return { user: req.user?.username || 'api' };
}

// POST /api/failover/ecmp
router.post('/ecmp', async (req, res) => {
  try {
    const out = await runCommand('set-ecmp', withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/failover/zte-only
router.post('/zte-only', async (req, res) => {
  try {
    const out = await runCommand('set-zte-only', withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/failover/digisol-only
router.post('/digisol-only', async (req, res) => {
  try {
    const out = await runCommand('set-digisol-only', withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/failover/run-setup
router.post('/run-setup', async (req, res) => {
  try {
    const out = await runCommand('run-setup', withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/failover/hash-policy  body: { policy: 0 | 1 }
router.post('/hash-policy', async (req, res) => {
  const policy = req.body?.policy;
  if (policy !== 0 && policy !== 1) {
    return res.status(400).json({ error: 'policy must be 0 or 1' });
  }
  try {
    const out = await setHashPolicy(policy, withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /api/failover/restart-service  body: { service: 'wan-routes' | 'dhcp' }
router.post('/restart-service', async (req, res) => {
  const { service } = req.body || {};
  const keyMap = { 'wan-routes': 'restart-wan-routes', dhcp: 'restart-dhcp' };
  const key = keyMap[service];
  if (!key) return res.status(400).json({ error: 'Invalid service name' });
  try {
    const out = await runCommand(key, withUser(req));
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

module.exports = router;
