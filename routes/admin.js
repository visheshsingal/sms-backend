const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// Admin signup (create first admin account)
router.post('/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });
    // If an email is provided, ensure it's not already in use.
    if (email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) return res.status(400).json({ message: 'Email already taken' });
    }
    const hash = await bcrypt.hash(password, 10);
    // Prefer an explicit email when provided; otherwise fall back to a placeholder
    const admin = new User({ username, passwordHash: hash, role: 'admin', email: email || `${username}@noemail.local` });
    await admin.save();
    res.json({ message: 'Admin created', username: admin.username, email: admin.email });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Create student/teacher accounts (admin only)
router.post('/create-user', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { username, password, role, email } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: 'Missing fields' });
    if (!['student', 'teacher'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });
    if (email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) return res.status(400).json({ message: 'Email already taken' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, passwordHash: hash, role, email: email || `${username}@noemail.local` });
    await user.save();
    res.json({ message: 'User created', username: user.username, role: user.role, email: user.email });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
