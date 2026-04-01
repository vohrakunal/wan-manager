const router = require('express').Router();
const fs = require('fs');
const readline = require('readline');
const ActionLog = require('../models/ActionLog');

const FAILOVER_LOG = process.env.FAILOVER_LOG || '/var/log/wan-failover.log';
const WAN_MGR_LOG  = process.env.WAN_MGR_LOG  || '/var/log/wan-manager.log';

function tailFile(filePath, lines = 200) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve([]);
    const content = fs.readFileSync(filePath, 'utf8');
    const all = content.split('\n').filter(Boolean);
    resolve(all.slice(-lines));
  });
}

// GET /api/logs/failover?lines=200
router.get('/failover', async (req, res) => {
  try {
    const lines = Math.min(parseInt(req.query.lines) || 200, 1000);
    const data = await tailFile(FAILOVER_LOG, lines);
    res.json({ lines: data, file: FAILOVER_LOG });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs/manager?lines=200
router.get('/manager', async (req, res) => {
  try {
    const lines = Math.min(parseInt(req.query.lines) || 200, 1000);
    const data = await tailFile(WAN_MGR_LOG, lines);
    res.json({ lines: data, file: WAN_MGR_LOG });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs/actions?limit=50  — from MongoDB
router.get('/actions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = await ActionLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
