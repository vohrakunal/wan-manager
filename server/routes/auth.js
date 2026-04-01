const { signToken } = require('../middleware/auth');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

module.exports = function loginHandler(req, res) {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = signToken(username);
    return res.json({ token, username });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
};
