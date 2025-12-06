const express = require('express');
const router = express.Router();
const Notice = require('../models/Notice');
const NoticeRead = require('../models/NoticeRead');
const auth = require('../middleware/auth');

// Helper to build visibility query for a given user
async function buildVisibilityQuery(req) {
  const query = {};
  if (req.user.role === 'admin') {
    // admins see everything (but unread endpoint should still consider read state)
    return query;
  }

  if (req.user.role === 'student') {
    const Student = require('../models/Student');
    const student = await Student.findOne({ userId: req.user._id });
    if (!student) return { _id: null }; // no results

    query.$or = [
      { targetStudent: student._id },
      { targetClass: student.class, targetStudent: null },
      { audience: { $in: ['all', 'students'] }, targetClass: null, targetStudent: null }
    ];
    return query;
  }

  if (req.user.role === 'teacher') {
    query.$or = [
      { audience: { $in: ['all', 'teachers'] }, targetClass: null, targetStudent: null },
      { author: req.user._id }
    ];
    return query;
  }

  // other roles (driver, bus-incharge, etc.)
  const roleMap = { driver: 'drivers', 'bus-incharge': 'bus-incharges' };
  const audienceKey = roleMap[req.user.role] || req.user.role;
  query.audience = { $in: ['all', audienceKey] };
  query.targetClass = null;
  query.targetStudent = null;
  return query;
}

// GET /unread  -> returns count and recent unread notices for current user
router.get('/unread', auth, async (req, res) => {
  try {
    const visibilityQuery = await buildVisibilityQuery(req);

    // Fetch candidate notices
    const candidates = await Notice.find(visibilityQuery).sort({ createdAt: -1 }).limit(50);

    // Find which of these are already read by this user
    const candidateIds = candidates.map(c => c._id);
    const reads = await NoticeRead.find({ noticeId: { $in: candidateIds }, userId: req.user._id }).select('noticeId');
    const readSet = new Set(reads.map(r => String(r.noticeId)));

    const unread = candidates.filter(c => !readSet.has(String(c._id)));

    res.json({ count: unread.length, notices: unread });
  } catch (err) {
    console.error('portalNotices /unread error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /:id/read  -> mark a notice as read for current user
router.post('/:id/read', auth, async (req, res) => {
  try {
    const noticeId = req.params.id;
    // Idempotent create
    const existing = await NoticeRead.findOne({ noticeId, userId: req.user._id });
    if (!existing) {
      await NoticeRead.create({ noticeId, userId: req.user._id });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('portalNotices mark read error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
