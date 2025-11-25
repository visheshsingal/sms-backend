const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Debug endpoint: shows decoded token payload and the resolved user from DB (requires auth)
router.get('/whoami', auth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  const token = parts.length === 2 ? parts[1] : null;
  let decoded = null;
  try {
    if (token) decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    decoded = { error: 'invalid token', message: err.message };
  }

  res.json({
    message: 'debug info',
    tokenPayload: decoded,
    userFromDb: req.user || null,
    authHeaderPresent: !!authHeader
  });
});

module.exports = router;
