const express = require('express');
const router = express.Router();
const Teacher = require('../models/Teacher');
const Class = require('../models/Class');
const Attendance = require('../models/Attendance');
const Assignment = require('../models/Assignment');
const Timetable = require('../models/Timetable');
const Progress = require('../models/Progress');
const auth = require('../middleware/auth');

// Get teacher profile by logged-in user
router.get('/me', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher profile not found' });
    res.json(teacher);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Get class assigned to this teacher (single class assumed)
router.get('/assigned-class', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    // Find classes where this teacher is the designated Class Teacher
    // include email so teacher UI can display student emails
    const classes = await Class.find({ classTeacher: teacher._id }).populate('students', 'firstName lastName rollNumber email profileImage admissionNumber fatherName aadharCard');
    // Return the first class (for compatibility with previous single-class assumption)
    res.json(classes && classes.length ? classes[0] : {});
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Get classes and subjects this teacher teaches (across classes)
router.get('/teaching-classes', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    // Find classes where this teacher appears in any subject.teachers OR is the classTeacher
    const classes = await Class.find({
      $or: [
        { 'subjects.teachers': teacher._id },
        { 'classTeacher': teacher._id }
      ]
    }).select('name subjects classTeacher').populate('subjects.teachers', 'firstName lastName');

    // For each class, filter subjects to only those taught by this teacher
    const result = classes.map((c) => ({
      _id: c._id,
      name: c.name,
      subjects: (c.subjects || []).filter(s => (s.teachers || []).some(t => String(t._id) === String(teacher._id))).map(s => ({ name: s.name }))
    }));

    res.json(result);
  } catch (err) { console.error('GET /teacher/teaching-classes error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Get attendance for assigned class (optional date range)
router.get('/assigned-class/attendance', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
    const classes = await Class.find({ classTeacher: teacher._id });
    const cls = classes && classes.length ? classes[0] : null;
    if (!cls) return res.status(404).json({ message: 'Class not assigned' });

    const { startDate, endDate } = req.query;
    const query = { classId: cls._id };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const records = await Attendance.find(query).populate('records.studentId', 'firstName lastName rollNumber');
    res.json(records);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Assignments: create for class (teacher)
router.post('/assignments', auth, async (req, res) => {
  try {
    // only teachers can create here
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const { classId, title, description, dueDate, attachments } = req.body;
    if (!classId || !title) return res.status(400).json({ message: 'classId and title required' });

    const a = new Assignment({ classId, title, description, dueDate, attachments, createdBy: teacher._id });
    await a.save();
    res.json(a);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Update assignment (teacher who created it)
router.put('/assignments/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (String(assignment.createdBy) !== String(teacher._id)) return res.status(403).json({ message: 'Not allowed' });

    const { title, description, dueDate, attachments } = req.body;
    if (title !== undefined) assignment.title = title;
    if (description !== undefined) assignment.description = description;
    if (dueDate !== undefined) assignment.dueDate = dueDate;
    if (attachments !== undefined) assignment.attachments = attachments;
    await assignment.save();
    res.json(assignment);
  } catch (err) { console.error('PUT /teacher/assignments/:id error:', err); res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete assignment (teacher who created it)
router.delete('/assignments/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (String(assignment.createdBy) !== String(teacher._id)) return res.status(403).json({ message: 'Not allowed' });

    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('DELETE /teacher/assignments/:id error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Get assignments for teacher's class(es)
router.get('/assignments', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    // Find all classes where this teacher teaches or is class teacher
    const classes = await Class.find({
      $or: [
        { 'subjects.teachers': teacher._id },
        { 'classTeacher': teacher._id }
      ]
    });

    if (!classes.length) return res.json([]);
    const classIds = classes.map(c => c._id);

    // Sort by createdAt desc
    const assignments = await Assignment.find({ classId: { $in: classIds } })
      .sort({ createdAt: -1 })
      .populate('classId', 'name');
    res.json(assignments);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Timetable: upload
router.post('/timetable', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    const { classId, content, imageUrl, date } = req.body;

    if (!classId || (!content && !imageUrl)) return res.status(400).json({ message: 'classId and content or image required' });

    const t = new Timetable({
      classId,
      content,
      imageUrl,
      date: date || new Date(),
      uploadedBy: teacher ? teacher._id : undefined
    });
    await t.save();
    res.json(t);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

router.get('/timetable/:classId', auth, async (req, res) => {
  try {
    const tt = await Timetable.find({ classId: req.params.classId }).sort({ date: -1, createdAt: -1 });
    res.json(tt);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Student progress: add and list
// Student progress: add single
router.post('/progress', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    const { studentId, classId, metrics, remarks, date, examName, subject, marks, outOf } = req.body;
    if (!studentId || !classId) return res.status(400).json({ message: 'studentId and classId required' });

    // Verify teacher access to class
    const cls = await Class.findOne({
      _id: classId,
      $or: [{ 'subjects.teachers': teacher._id }, { 'classTeacher': teacher._id }]
    });
    if (!cls) return res.status(403).json({ message: 'You are not assigned to this class' });

    const p = new Progress({
      studentId,
      classId,
      teacherId: teacher ? teacher._id : undefined,
      metrics,
      remarks,
      date,
      examName,
      subject,
      marks,
      outOf
    });
    await p.save();
    res.json(p);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Student progress: bulk add
router.post('/progress/bulk', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: 'Forbidden' });
    const teacher = await Teacher.findOne({ userId: req.user.id });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const { classId, examName, subject, outOf, date, records } = req.body;
    // records: [{ studentId, marks, remarks }]

    if (!classId || !records || !Array.isArray(records)) return res.status(400).json({ message: 'Invalid data' });

    // Verify teacher access to class
    const cls = await Class.findOne({
      _id: classId,
      $or: [{ 'subjects.teachers': teacher._id }, { 'classTeacher': teacher._id }]
    });
    if (!cls) return res.status(403).json({ message: 'You are not assigned to this class' });

    const progressDocs = records.map(r => ({
      studentId: r.studentId,
      classId,
      teacherId: teacher._id,
      examName,
      subject,
      date: date || new Date(),
      outOf: outOf ? Number(outOf) : undefined,
      marks: r.marks !== '' ? Number(r.marks) : undefined, // allow empty marks
      absent: !!r.absent,
      remarks: r.remarks
    }));

    // Filter out entries with no marks and no remarks to avoid junk? 
    // The user might want to record '0' or just remarks.
    // We will save whatever is sent.

    await Progress.insertMany(progressDocs);
    res.json({ message: 'Progress records saved', count: progressDocs.length });
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

router.get('/progress/:studentId', auth, async (req, res) => {
  try {
    const records = await Progress.find({ studentId: req.params.studentId }).sort({ date: -1 });
    res.json(records);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
