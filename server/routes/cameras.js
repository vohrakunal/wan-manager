const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');

const CAMERAS_FILE = process.env.CAMERAS_FILE || path.join(__dirname, '../../cameras.json');
const GO2RTC_CONFIG = process.env.GO2RTC_CONFIG || '/etc/go2rtc.yaml';
// go2rtc WebRTC HTTP API — bound to localhost only
const GO2RTC_HOST = process.env.GO2RTC_HOST || '127.0.0.1';
const GO2RTC_PORT = parseInt(process.env.GO2RTC_PORT || '1984');

function readCameras() {
  if (!fs.existsSync(CAMERAS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8')); }
  catch { return []; }
}

function writeCameras(cameras) {
  const dir = path.dirname(CAMERAS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CAMERAS_FILE, JSON.stringify(cameras, null, 2));
}

// Regenerate go2rtc.yaml from current cameras list and restart the service
function applyGo2rtcConfig(cameras) {
  const streams = cameras.map(c => {
    const url = `rtsp://${encodeURIComponent(c.user)}:${encodeURIComponent(c.pass)}@${c.ip}:554/stream1`;
    return `  ${c.id}: ${url}`;
  }).join('\n');

  const yaml = [
    'api:',
    `  listen: 127.0.0.1:${GO2RTC_PORT}`,
    '',
    'rtsp:',
    '  listen: :8554',
    '',
    'streams:',
    streams || '  {}',
    '',
    'webrtc:',
    '  listen: :8555/tcp',
    '  candidates:',
    '    - 192.168.1.254',
    '',
  ].join('\n');

  try {
    fs.writeFileSync(GO2RTC_CONFIG, yaml);
    exec('sudo -n systemctl restart go2rtc', () => {});
  } catch (_) {}
}

// GET /api/cameras — list all cameras (passwords redacted)
router.get('/', (req, res) => {
  const cameras = readCameras().map(({ pass: _, ...c }) => c);
  res.json(cameras);
});

// POST /api/cameras — add a camera
router.post('/', (req, res) => {
  const { name, ip, user, pass } = req.body;
  if (!name || !ip || !user || !pass) {
    return res.status(400).json({ error: 'name, ip, user, pass are required' });
  }
  const cameras = readCameras();
  // Slug ID from name — lowercase, spaces→dashes
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (cameras.find(c => c.id === id)) {
    return res.status(409).json({ error: `Camera with id "${id}" already exists` });
  }
  const camera = { id, name, ip, user, pass };
  cameras.push(camera);
  writeCameras(cameras);
  applyGo2rtcConfig(cameras);
  const { pass: _, ...safe } = camera;
  res.status(201).json(safe);
});

// DELETE /api/cameras/:id
router.delete('/:id', (req, res) => {
  const cameras = readCameras();
  const idx = cameras.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Camera not found' });
  cameras.splice(idx, 1);
  writeCameras(cameras);
  applyGo2rtcConfig(cameras);
  res.json({ ok: true });
});

// PUT /api/cameras/:id — update a camera (pass optional — keeps existing if omitted)
router.put('/:id', (req, res) => {
  const cameras = readCameras();
  const cam = cameras.find(c => c.id === req.params.id);
  if (!cam) return res.status(404).json({ error: 'Camera not found' });
  const { name, ip, user, pass } = req.body;
  if (name) cam.name = name;
  if (ip)   cam.ip   = ip;
  if (user) cam.user = user;
  if (pass) cam.pass = pass;
  writeCameras(cameras);
  applyGo2rtcConfig(cameras);
  const { pass: _, ...safe } = cam;
  res.json(safe);
});

// GET /api/cameras/stream/:id — proxy go2rtc WebRTC HTTP API (requires auth via parent middleware)
// go2rtc serves an embeddable HTML page at /:streamId and a WebRTC signalling API
// We proxy everything under /api/cameras/stream/:id/* to go2rtc's HTTP API
router.get('/stream/:id', (req, res) => {
  const target = `/${req.params.id}`;
  proxyGo2rtc(req, res, target);
});

// Proxy all go2rtc sub-paths (WebRTC signalling: /api/webrtc?src=..., /api/ws, etc.)
router.use('/go2rtc/*', (req, res) => {
  const subpath = req.path.replace(/^\/go2rtc/, '') + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '');
  proxyGo2rtc(req, res, subpath);
});

function proxyGo2rtc(req, res, targetPath) {
  const options = {
    hostname: GO2RTC_HOST,
    port: GO2RTC_PORT,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${GO2RTC_HOST}:${GO2RTC_PORT}`,
    },
  };
  // Strip headers that would cause issues
  delete options.headers['authorization'];

  const proxy = http.request(options, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', () => res.status(502).json({ error: 'go2rtc unavailable' }));
  req.pipe(proxy);
}

module.exports = router;
