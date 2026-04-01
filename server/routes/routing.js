const router = require('express').Router();
const { runCommand } = require('../lib/executor');

// GET /api/routing/default
router.get('/default', async (req, res) => {
  try { res.json({ output: await runCommand('route-default') }); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/routing/main
router.get('/main', async (req, res) => {
  try { res.json({ output: await runCommand('route-main') }); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/routing/zte
router.get('/zte', async (req, res) => {
  try { res.json({ output: await runCommand('route-zte') }); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/routing/digisol
router.get('/digisol', async (req, res) => {
  try { res.json({ output: await runCommand('route-digisol') }); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

// GET /api/routing/rules
router.get('/rules', async (req, res) => {
  try {
    const output = await runCommand('rule-list');
    // Duplicate detection: count occurrences of each 'from' IP
    const lines = output.split('\n');
    const fromCounts = {};
    for (const line of lines) {
      const m = line.match(/from\s+(\S+)/);
      if (m && m[1] !== 'all') fromCounts[m[1]] = (fromCounts[m[1]] || 0) + 1;
    }
    const duplicates = Object.entries(fromCounts)
      .filter(([, count]) => count > 2)
      .map(([ip]) => ip);

    res.json({ output, duplicates, totalRules: lines.filter(l => l.trim()).length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/routing/all — fetch all tables at once
router.get('/all', async (req, res) => {
  const [def, main, zte, digisol, rules] = await Promise.allSettled([
    runCommand('route-default'),
    runCommand('route-main'),
    runCommand('route-zte'),
    runCommand('route-digisol'),
    runCommand('rule-list'),
  ]);
  res.json({
    default: def.value    || def.reason,
    main:    main.value   || main.reason,
    zte:     zte.value    || zte.reason,
    digisol: digisol.value || digisol.reason,
    rules:   rules.value  || rules.reason,
  });
});

// POST /api/routing/fix — flush and re-add correct rules
router.post('/fix', async (req, res) => {
  try {
    const out = await runCommand('route-fix', { user: req.user?.username });
    res.json({ success: true, output: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

module.exports = router;
