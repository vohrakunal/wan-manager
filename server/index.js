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
const { setupTerminalWss } = require('./routes/terminal');

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

// WebSocket terminal
setupTerminalWss(server);

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
