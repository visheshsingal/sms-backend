const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// generic login route for any role
router.post('/login', async (req, res) => {
  // Allow login by either username or email
  const { username, email, password } = req.body;
  if ((!username && !email) || !password) return res.status(400).json({ message: 'Missing credentials' });
  let user = null;
  if (email) {
    // try direct match on User.email
    user = await User.findOne({ email });
    // fallback: some accounts store email on the role document (Student/Teacher/Driver)
    if (!user) {
      const Student = require('../models/Student');
      const Teacher = require('../models/Teacher');
      const Driver = require('../models/Driver');
      const s = await Student.findOne({ email });
      if (s && s.userId) user = await User.findById(s.userId);
      if (!user) {
        const t = await Teacher.findOne({ email });
        if (t && t.userId) user = await User.findById(t.userId);
      }
      if (!user) {
        const d = await Driver.findOne({ email });
        if (d && d.userId) user = await User.findById(d.userId);
        if (!user) {
          const BusIncharge = require('../models/BusIncharge');
          const bi = await BusIncharge.findOne({ email });
          if (bi && bi.userId) user = await User.findById(bi.userId);
        }
      }
    }
  } else {
    user = await User.findOne({ username });
  }
  if (!user) return res.status(400).json({ message: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ message: 'Invalid credentials' });
  const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, role: user.role, username: user.username, email: user.email });
});

module.exports = router;
