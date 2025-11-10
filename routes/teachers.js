const express = require('express');
const router = express.Router();
const Teacher = require('../models/Teacher');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// List teachers
router.get('/', auth, async (req, res) => {
  try {
    const teachers = await Teacher.find().sort({ createdAt: -1 });
    res.json(teachers);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create teacher (admin only)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    let { username, password, ...teacherData } = req.body;

    // basic validation for teacher fields
    if (!teacherData.firstName || !teacherData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });

    // If password provided but username missing, derive from email local-part
    if (password && !username && teacherData.email) {
      username = (teacherData.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
    }

    // If no credentials provided, create teacher without linked User
    if (!username && !password) {
      const t = new Teacher({ ...teacherData });
      await t.save();
      return res.json(t);
    }

    // If either username or password present, both are required to create a login
    if (!username || !password) return res.status(400).json({ message: 'Both username and password are required to create a login for teacher' });

    // Ensure username unused
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, passwordHash: hash, role: 'teacher', email: teacherData.email || `${username}@noemail.local` });
    await user.save();

    const t = new Teacher({ ...teacherData, userId: user._id });
    await t.save();
    res.json(t);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Get single
router.get('/:id', auth, async (req, res) => {
  try {
    const t = await Teacher.findById(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });
    res.json(t);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { username, password, ...update } = req.body;
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Not found' });

    // Manage username/password for linked User
    if (username || password) {
      let user = null;
      if (teacher.userId) user = await User.findById(teacher.userId);

      if (username) {
        const existing = await User.findOne({ username });
        if (existing && (!user || existing._id.toString() !== user._id.toString())) {
          return res.status(400).json({ message: 'Username already taken' });
        }
        if (user) {
          user.username = username;
        } else {
          // If creating a new user and username missing but password provided, derive username from teacher email
          if (!password) return res.status(400).json({ message: 'Password required when creating new user' });
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'teacher', email: teacher.email || `${username}@noemail.local` });
          await user.save();
          teacher.userId = user._id;
        }
      } else if (password && !username && !user) {
        // derive username from email if not provided
        if (teacher.email) {
          const derived = (teacher.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username: derived, passwordHash: hash, role: 'teacher', email: teacher.email });
          await user.save();
          teacher.userId = user._id;
        } else {
          return res.status(400).json({ message: 'Email required to derive username when creating user without explicit username' });
        }
      }

      if (password && user) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }

      if (user) await user.save();
    }

    Object.assign(teacher, update);
    await teacher.save();
    res.json(teacher);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ message: 'Not found' });
    if (teacher.userId){
      await User.findByIdAndDelete(teacher.userId);
    }
    await Teacher.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
