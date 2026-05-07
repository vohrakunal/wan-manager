require('dotenv').config({ path: '../.env' });
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { connectDB } = require('./lib/db');
const { authMiddleware } = require('./middleware/auth');

const wanRoutes = require('./routes/wan');
const failoverRoutes = require('./routes/failover');
const dhcpRoutes = require('./routes/dhcp');
const routingRoutes = require('./routes/routing');
const logsRoutes = require('./routes/logs');
const streamRoutes = require('./routes/stream');
const diagnosticsRoutes = require('./routes/diagnostics');
const servicesRoutes    = require('./routes/services');
const filesRoutes       = require('./routes/files');
const networkRoutes     = require('./routes/network');
const { router: camerasRoutes, go2rtcProxy } = require('./routes/cameras');
const { setupTerminalWss } = require('./routes/terminal');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Connect to MongoDB
connectDB();

// Middleware
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Auth endpoint (no auth required)
app.post('/api/auth/login', require('./routes/auth'));

// go2rtc proxy — no auth on sub-requests because the HTML page's own JS fetches
// these without headers; the iframe itself is only served after JWT auth passes.
app.use('/api/cameras/go2rtc', go2rtcProxy);

// Protected API routes
app.use('/api', authMiddleware);
app.use('/api/wan', wanRoutes);
app.use('/api/failover', failoverRoutes);
app.use('/api/dhcp', dhcpRoutes);
app.use('/api/routing', routingRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/services',    servicesRoutes);
app.use('/api/files',       filesRoutes);
app.use('/api/network',     networkRoutes);
app.use('/api/cameras',     camerasRoutes);

// WebSocket terminal
setupTerminalWss(server);

// Proxy WebSocket connections for go2rtc (/api/cameras/go2rtc/api/ws?src=...)
// go2rtc uses WS for MSE/WebRTC signalling; we tunnel it to localhost:1984
const go2rtcWss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/cameras/go2rtc/')) return;
  go2rtcWss.handleUpgrade(req, socket, head, (ws) => {
    const subpath = req.url.replace('/api/cameras/go2rtc', '');
    const upstream = new (require('ws'))(
      `ws://127.0.0.1:${process.env.GO2RTC_PORT || 1984}${subpath}`
    );
    upstream.on('open', () => {
      ws.on('message', (data, isBinary) => upstream.readyState === 1 && upstream.send(data, { binary: isBinary }));
      upstream.on('message', (data, isBinary) => ws.readyState === 1 && ws.send(data, { binary: isBinary }));
    });
    upstream.on('close', () => ws.close());
    ws.on('close', () => upstream.close());
    upstream.on('error', () => ws.close());
    ws.on('error', () => upstream.close());
  });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

server.listen(PORT, HOST, () => {
  console.log(`WAN Manager running on http://${HOST}:${PORT}`);
});
