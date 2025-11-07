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
    const { username, password, ...teacherData } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'username and password required for teacher account' });

    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ message: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, passwordHash: hash, role: 'teacher', email: `${username}@noemail.local` });
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
    const t = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!t) return res.status(404).json({ message: 'Not found' });
    res.json(t);
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
