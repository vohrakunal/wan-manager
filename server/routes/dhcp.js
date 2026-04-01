const router = require('express').Router();
const { parseLeases, parseReservations, addReservation, removeReservation } = require('../lib/parser');
const { runCommand } = require('../lib/executor');

const LEASES_FILE       = process.env.DHCP_LEASES_FILE || '/var/lib/dhcp/dhcpd.leases';
const DHCPD_CONF_FILE   = process.env.DHCPD_CONF_FILE  || '/etc/dhcp/dhcpd.conf';
const DHCP_POOL_START   = parseInt(process.env.DHCP_POOL_START || '100');
const DHCP_POOL_END     = parseInt(process.env.DHCP_POOL_END   || '200');

// GET /api/dhcp/leases
router.get('/leases', (req, res) => {
  try {
    const leases       = parseLeases(LEASES_FILE);
    const reservations = parseReservations(DHCPD_CONF_FILE);
    const staticMacs   = new Set(reservations.map(r => r.mac));

    const enriched = leases.map(l => ({ ...l, isStatic: staticMacs.has(l.mac) }));
    const active   = enriched.filter(l => l.status === 'active');

    const poolSize = DHCP_POOL_END - DHCP_POOL_START + 1;
    res.json({ leases: enriched, total: enriched.length, active: active.length, poolSize, poolUsed: active.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dhcp/reservations
router.get('/reservations', (req, res) => {
  try {
    res.json(parseReservations(DHCPD_CONF_FILE));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dhcp/reservations
router.post('/reservations', async (req, res) => {
  const { mac, ip, hostname } = req.body || {};

  // Validate inputs strictly — never trust user input for shell ops
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' });
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address' });
  }
  if (hostname && !/^[a-zA-Z0-9-]{1,63}$/.test(hostname)) {
    return res.status(400).json({ error: 'Invalid hostname' });
  }

  try {
    addReservation(DHCPD_CONF_FILE, { mac: mac.toLowerCase(), ip, hostname: hostname || '' });
    await runCommand('restart-dhcp', { user: req.user?.username, note: `added reservation ${mac}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dhcp/reservations/:mac
router.delete('/reservations/:mac', async (req, res) => {
  const mac = req.params.mac;
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) {
    return res.status(400).json({ error: 'Invalid MAC address' });
  }
  try {
    removeReservation(DHCPD_CONF_FILE, mac.toLowerCase());
    await runCommand('restart-dhcp', { user: req.user?.username, note: `removed reservation ${mac}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dhcp/restart
router.post('/restart', async (req, res) => {
  try {
    const out = await runCommand('restart-dhcp', { user: req.user?.username });
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

module.exports = router;
