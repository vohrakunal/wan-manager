const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

function isStreamGetRequest(req) {
  return req.method === 'GET' && (
    req.path.startsWith('/stream/') ||
    req.path.startsWith('/diagnostics/')
  );
}

function getTokenFromRequest(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  // EventSource cannot send custom Authorization headers in browsers,
  // so we allow query token only for stream endpoints.
  if (isStreamGetRequest(req) && typeof req.query?.token === 'string' && req.query.token.length > 0) {
    return req.query.token;
  }

  return null;
}

function authMiddleware(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
}

module.exports = { authMiddleware, signToken };
