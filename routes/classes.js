const express = require('express');
const router = express.Router();
const ClassModel = require('../models/Class');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const auth = require('../middleware/auth');

// List classes
router.get('/', auth, async (req, res) => {
  try {
    const classes = await ClassModel.find()
      .populate('students', 'firstName lastName')
      .populate('subjects.teachers', 'firstName lastName');
    res.json(classes);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Get single class with populated students, teacher and subject teachers
router.get('/:id', auth, async (req, res) => {
  try {
    const c = await ClassModel.findById(req.params.id)
      .populate('students', 'firstName lastName rollNumber')
      .populate('subjects.teachers', 'firstName lastName');
    if (!c) return res.status(404).json({ message: 'Not found' });
    res.json(c);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create class (supports optional subjects with assigned teacher ids)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name, subjects } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const exists = await ClassModel.findOne({ name });
    if (exists) return res.status(400).json({ message: 'Class with that name already exists' });

  const classDoc = new ClassModel({ name });

    // If subjects provided, validate and attach
    if (Array.isArray(subjects)) {
      const cleaned = [];
      for (const s of subjects) {
        if (!s || !s.name) continue;
        const subj = { name: s.name };
        if (Array.isArray(s.teacherIds) && s.teacherIds.length) {
          // validate teacher ids
          const teachers = await Teacher.find({ _id: { $in: s.teacherIds } });
          if (teachers.length !== s.teacherIds.length) return res.status(400).json({ message: `Invalid teacherIds for subject ${s.name}` });
          subj.teachers = s.teacherIds;
        }
        cleaned.push(subj);
      }
      classDoc.subjects = cleaned;
    }

    await classDoc.save();
  const populated = await ClassModel.findById(classDoc._id).populate('subjects.teachers', 'firstName lastName');
    res.json(populated);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Update class: assign teacher, students, and subjects
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { studentIds, subjects } = req.body; // studentIds: array, subjects: [{ name, teacherIds }]
    const update = {};
    if (studentIds) {
      // validate student ids
      const students = await Student.find({ _id: { $in: studentIds } });
      if (students.length !== studentIds.length) return res.status(400).json({ message: 'One or more studentIds invalid' });
      update.students = studentIds;
    }

    if (Array.isArray(subjects)) {
      const cleaned = [];
      for (const s of subjects) {
        if (!s || !s.name) continue;
        const subj = { name: s.name };
        if (Array.isArray(s.teacherIds) && s.teacherIds.length) {
          const teachers = await Teacher.find({ _id: { $in: s.teacherIds } });
          if (teachers.length !== s.teacherIds.length) return res.status(400).json({ message: `Invalid teacherIds for subject ${s.name}` });
          subj.teachers = s.teacherIds;
        }
        cleaned.push(subj);
      }
      update.subjects = cleaned;
    }

    const c = await ClassModel.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('students', 'firstName lastName')
      .populate('subjects.teachers', 'firstName lastName');
    if (!c) return res.status(404).json({ message: 'Not found' });
    res.json(c);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete class
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    await ClassModel.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
