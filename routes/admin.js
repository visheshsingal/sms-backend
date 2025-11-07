const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// Admin signup (create first admin account)
router.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
  const admin = new User({ username, passwordHash: hash, role: 'admin', email: `${username}@noemail.local` });
    await admin.save();
    res.json({ message: 'Admin created', username: admin.username });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Create student/teacher accounts (admin only)
router.post('/create-user', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: 'Missing fields' });
    if (!['student', 'teacher'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, passwordHash: hash, role, email: `${username}@noemail.local` });
    await user.save();
    res.json({ message: 'User created', username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
