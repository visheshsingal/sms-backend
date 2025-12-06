const express = require('express');
const router = express.Router();
const Notice = require('../models/Notice');
const auth = require('../middleware/auth');

// Get all notices (optionally filter by audience)
// Get all notices (optionally filter by audience)
router.get('/', auth, async (req, res) => {
  try {
    const { audience, source } = req.query; // optional source: 'admin' or 'teacher'
    const query = {};

    // Source filtering helper
    // If source=admin, author must be admin role
    // If source=teacher, author must be teacher role
    // This requires populating author or checking author ids.
    // Easier way: Store role in Notice? No.
    // We can filter by author type. We will fetch users of that role.

    let authorFilter = null;
    if (source === 'admin') {
      const User = require('../models/User');
      const admins = await User.find({ role: 'admin' }).select('_id');
      authorFilter = { $in: admins.map(a => a._id) };
    } else if (source === 'teacher') {
      const User = require('../models/User');
      const teachers = await User.find({ role: 'teacher' }).select('_id');
      authorFilter = { $in: teachers.map(t => t._id) };
    }

    if (req.user.role === 'admin') {
      if (audience) query.audience = audience;
    }
    else if (req.user.role === 'student') {
      // Find student profile to know ID and Class
      const Student = require('../models/Student');
      const student = await Student.findOne({ userId: req.user._id });
      if (!student) return res.json([]); // No student profile, see nothing? or just 'all'

      query.$or = [
        { targetStudent: student._id },
        { targetClass: student.class, targetStudent: null },
        { audience: { $in: ['all', 'students'] }, targetClass: null, targetStudent: null }
      ];
    }
    else if (req.user.role === 'teacher') {
      // Teachers see general notices for them, AND notices they created
      query.$or = [
        { audience: { $in: ['all', 'teachers'] }, targetClass: null, targetStudent: null },
        { author: req.user._id }
      ];
    }
    else {
      // other roles (driver, bus-incharge, etc.)
      const roleMap = { driver: 'drivers', 'bus-incharge': 'bus-incharges' };
      const audienceKey = roleMap[req.user.role] || req.user.role;
      query.audience = { $in: ['all', audienceKey] };
      query.targetClass = null;
      query.targetStudent = null;
    }

    // Apply author filter if explicit source requested
    if (authorFilter) {
      if (query.$or) {
        // Need to apply AND (authorFilter) to the $or condition
        // { $and: [ { $or: [...] }, { author: authorFilter } ] }
        query.$and = [{ $or: query.$or }, { author: authorFilter }];
        delete query.$or;
      } else {
        query.author = authorFilter;
      }
    }

    const notices = await Notice.find(query)
      .sort({ createdAt: -1 })
      .populate('author', 'username')
      .populate('targetClass', 'name')
      .populate('targetStudent', 'firstName lastName');
    res.json(notices);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create notice (admin or teacher)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { title, body, audience, targetClass, targetStudent } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body required' });

    const payload = { title, body, author: req.user.id };

    if (req.user.role === 'teacher') {
      // Teachers mainly message students
      payload.audience = 'students';
      if (targetClass) payload.targetClass = targetClass;
      if (targetStudent) payload.targetStudent = targetStudent;
    } else {
      // Admin
      if (audience) payload.audience = audience;
      if (targetClass) payload.targetClass = targetClass;
      if (targetStudent) payload.targetStudent = targetStudent;
    }

    const notice = new Notice(payload);
    await notice.save();
    res.json(notice);
  } catch (err) {
    res.status(400).json({ message: 'Bad request', error: err.message });
  }
});

// Update notice (admin)
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const notice = await Notice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!notice) return res.status(404).json({ message: 'Not found' });
    res.json(notice);
  } catch (err) {
    res.status(400).json({ message: 'Bad request', error: err.message });
  }
});

// Delete notice (admin)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    await Notice.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
