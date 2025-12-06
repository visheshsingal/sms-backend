const express = require('express');
const router = express.Router();
const Leave = require('../models/Leave');
const Student = require('../models/Student');
const auth = require('../middleware/auth');

// Create leave (student)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Only students can apply for leave' });
    const student = await Student.findOne({ userId: req.user.id });
    if (!student) return res.status(404).json({ message: 'Student profile not found' });
    const { from, to, reason } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'from and to dates required' });
    const leave = new Leave({
      studentId: student._id,
      from: new Date(from),
      to: new Date(to),
      reason,
      history: [{
        sender: req.user.id,
        role: 'student',
        message: reason,
        action: 'applied',
        date: new Date()
      }]
    });
    await leave.save();
    res.json(leave);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Student: list own leaves
router.get('/me', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ message: 'Forbidden' });
    const student = await Student.findOne({ userId: req.user.id });
    if (!student) return res.status(404).json({ message: 'Student profile not found' });
    const leaves = await Leave.find({ studentId: student._id }).sort({ createdAt: -1 });
    res.json(leaves);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Admin/teacher: list all pending leaves (or filter)
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role === 'student') return res.status(403).json({ message: 'Forbidden' });
    const { status } = req.query;
    const q = {};
    if (status) q.status = status;
    const leaves = await Leave.find(q).populate('studentId', 'firstName lastName').sort({ createdAt: -1 });
    res.json(leaves);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Approve/reject leave (teacher/admin)
// Approve/reject/reapply leave
router.put('/:id', auth, async (req, res) => {
  try {
    const { status, message } = req.body;
    // status can be 'approved', 'rejected' (teacher/admin) or 'pending' (student re-apply)

    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ message: 'Not found' });

    // Identify actor
    if (req.user.role === 'student') {
      // Re-apply logic
      // Verify ownership
      const student = await Student.findOne({ userId: req.user.id });
      if (!student || String(leave.studentId) !== String(student._id)) return res.status(403).json({ message: 'Forbidden' });

      if (status !== 'pending') return res.status(400).json({ message: 'Students can only set status to pending (re-apply)' });

      leave.status = 'pending';
      leave.history.push({
        sender: req.user.id,
        role: 'student',
        message: message || 'Re-applied',
        action: 'reapplied',
        date: new Date()
      });
      // Optionally update the main reason if provided? Keeping original reason is usually better for context, 
      // the chat history has the new info.
    } else if (req.user.role === 'teacher' || req.user.role === 'admin') {
      // Approve/Reject logic
      if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status' });

      // If teacher, ensure they are the Class Teacher
      if (req.user.role === 'teacher') {
        const student = await Student.findById(leave.studentId);
        if (!student || !student.class) return res.status(403).json({ message: 'Student has no class assigned' });

        const Class = require('../models/Class');
        const cls = await Class.findById(student.class);
        const Teacher = require('../models/Teacher');
        const teacher = await Teacher.findOne({ userId: req.user.id });

        if (!teacher || !cls || String(cls.classTeacher) !== String(teacher._id)) {
          return res.status(403).json({ message: 'Only the Class Teacher can approve/reject leaves' });
        }
      }

      leave.status = status;
      leave.reviewedBy = req.user.id;
      leave.reviewedAt = new Date();
      leave.history.push({
        sender: req.user.id,
        role: req.user.role,
        message: message || status, // Reason/Message required for rejection ideally
        action: status,
        date: new Date()
      });
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await leave.save();
    res.json(leave);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

module.exports = router;
