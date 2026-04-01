const router = require('express').Router();
const fs = require('fs');
const { readProcNetDev } = require('../lib/parser');
const { exec } = require('child_process');

const INTERFACES = {
  zte:     'eno1',
  digisol: 'enx207bd51a8b0b',
};

const FAILOVER_LOG = process.env.FAILOVER_LOG || '/var/log/wan-failover.log';

function execAsync(cmd) {
  return new Promise(resolve => {
    exec(cmd, { timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

// GET /api/stream/status  — SSE, sends WAN status every 10s
router.get('/status', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let prevNetDev = null;
  let prevTime   = null;

  async function send() {
    const [routeOut, netDev] = await Promise.all([
      execAsync('ip route show default'),
      Promise.resolve(readProcNetDev()),
    ]);

    const now = Date.now();
    let zteRate = null, digiRate = null;
    if (prevNetDev && prevTime) {
      const dt = (now - prevTime) / 1000;
      const zP = prevNetDev[INTERFACES.zte],     zC = netDev[INTERFACES.zte];
      const dP = prevNetDev[INTERFACES.digisol],  dC = netDev[INTERFACES.digisol];
      if (zP && zC) zteRate  = { rxRate: Math.max(0, (zC.rxBytes - zP.rxBytes) / dt), txRate: Math.max(0, (zC.txBytes - zP.txBytes) / dt) };
      if (dP && dC) digiRate = { rxRate: Math.max(0, (dC.rxBytes - dP.rxBytes) / dt), txRate: Math.max(0, (dC.txBytes - dP.txBytes) / dt) };
    }
    prevNetDev = netDev;
    prevTime   = now;

    const route = routeOut || '';
    let mode = 'unknown';
    if (route.includes('nexthop')) mode = 'ecmp';
    else if (route.includes(INTERFACES.zte)) mode = 'zte-only';
    else if (route.includes(INTERFACES.digisol)) mode = 'digisol-only';

    const payload = {
      timestamp: new Date().toISOString(),
      mode,
      zte:     { ...netDev[INTERFACES.zte],     ...(zteRate  || {}) },
      digisol: { ...netDev[INTERFACES.digisol], ...(digiRate || {}) },
    };

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  await send();
  const interval = setInterval(send, 10000);
  req.on('close', () => clearInterval(interval));
});

// GET /api/stream/logs  — SSE, tails wan-failover.log
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let lastSize = 0;
  try {
    if (fs.existsSync(FAILOVER_LOG)) {
      lastSize = fs.statSync(FAILOVER_LOG).size;
      // Send last 50 lines on connect
      const content = fs.readFileSync(FAILOVER_LOG, 'utf8');
      const lines = content.split('\n').filter(Boolean).slice(-50);
      res.write(`data: ${JSON.stringify({ lines, initial: true })}\n\n`);
    }
  } catch {}

  const interval = setInterval(() => {
    try {
      if (!fs.existsSync(FAILOVER_LOG)) return;
      const stat = fs.statSync(FAILOVER_LOG);
      if (stat.size <= lastSize) return;

      const fd = fs.openSync(FAILOVER_LOG, 'r');
      const buf = Buffer.alloc(stat.size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;

      const newLines = buf.toString('utf8').split('\n').filter(Boolean);
      if (newLines.length > 0) {
        res.write(`data: ${JSON.stringify({ lines: newLines, initial: false })}\n\n`);
      }
    } catch {}
  }, 2000);

  req.on('close', () => clearInterval(interval));
});

module.exports = router;
