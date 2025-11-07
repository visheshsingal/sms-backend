const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const Class = require('../models/Class');
const Assignment = require('../models/Assignment');
const Timetable = require('../models/Timetable');
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

// Helper: find student by linked userId; if not found, try to match by email==username and link automatically
async function resolveStudentForUser(user){
  // try by userId
  // populate the student's class with students and per-subject teachers (class-level 'teacher' was removed)
  let student = await Student.findOne({ userId: user._id }).populate({
    path: 'class',
    populate: [
      { path: 'students', select: 'firstName lastName rollNumber' },
      // populate teachers for each subject (subjects -> teachers)
      { path: 'subjects.teachers', select: 'firstName lastName' }
    ]
  });
  if (student) return student;

  // fallback: try to find by email matching username and link
  if (user.username) {
    student = await Student.findOne({ email: user.username }).populate({
      path: 'class',
      populate: [
        { path: 'students', select: 'firstName lastName rollNumber' },
        { path: 'subjects.teachers', select: 'firstName lastName' }
      ]
    });
    if (student) {
      student.userId = user._id;
      try { await student.save(); console.log(`Linked existing Student(${student._id}) to User(${user._id}) by email`); } catch(err){ console.warn('Failed to link student to user:', err.message); }
      return student;
    }
  }

  return null;
}

// Get student profile (by logged-in user)
router.get('/me', auth, async (req, res) => {
  try {
    const student = await resolveStudentForUser(req.user);
    if (!student) return res.status(404).json({ message: 'Student not found. Ask admin to link your account or create a student record with this email.' });
    res.json({ student, class: student.class });
  } catch (err) { console.error('GET /student/me error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Assignments for student's class
router.get('/me/assignments', auth, async (req, res) => {
  try {
    const student = await resolveStudentForUser(req.user);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const classId = student.class && student.class._id ? student.class._id : student.class;
    const assignments = await Assignment.find({ classId }).sort({ createdAt: -1 }).populate('createdBy', 'firstName lastName');
    res.json(assignments);
  } catch (err) { console.error('GET /student/me/assignments error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Timetable for student's class
router.get('/me/timetable', auth, async (req, res) => {
  try {
    const student = await resolveStudentForUser(req.user);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const classId = student.class && student.class._id ? student.class._id : student.class;
    const timetables = await Timetable.find({ classId }).sort({ createdAt: -1 }).populate('uploadedBy', 'firstName lastName');
    res.json(timetables);
  } catch (err) { console.error('GET /student/me/timetable error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Attendance summary for the student in a date range
router.get('/me/attendance', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
  const student = await resolveStudentForUser(req.user);
  if (!student) return res.status(404).json({ message: 'Student not found' });
  const classId = student.class && student.class._id ? student.class._id : student.class;
    if (!classId) return res.status(400).json({ message: 'Student not assigned to class' });

    const q = { classId };
    if (startDate && endDate) q.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

  const records = await Attendance.find(q);
    const totalDays = records.length;
    const presentDays = records.reduce((acc, rec) => {
      const r = rec.records.find(r => r.studentId.toString() === student._id.toString());
      return acc + (r && r.status === 'present' ? 1 : 0);
    }, 0);

    const percentage = totalDays ? (presentDays / totalDays) * 100 : 0;
    res.json({ totalDays, presentDays, percentage });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Detailed attendance entries for the logged-in student (per-date)
router.get('/me/attendance/report', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
  const student = await resolveStudentForUser(req.user);
  if (!student) return res.status(404).json({ message: 'Student not found' });
  const classId = student.class && student.class._id ? student.class._id : student.class;
    if (!classId) return res.status(400).json({ message: 'Student not assigned to class' });

    const q = { classId };
    if (startDate && endDate) q.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const records = await Attendance.find(q).sort({ date: 1 });

    const entries = records.map(rec => {
      const sr = rec.records.find(r => r.studentId.toString() === student._id.toString());
      return {
        date: rec.date,
        status: sr ? sr.status : 'not-marked'
      };
    });

    const totalDays = entries.length;
    const presentDays = entries.reduce((acc, e) => acc + (e.status === 'present' ? 1 : 0), 0);
    const percentage = totalDays ? (presentDays / totalDays) * 100 : 0;

    res.json({ totalDays, presentDays, percentage, entries });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
