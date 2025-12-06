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
      .populate('subjects.teachers', 'firstName lastName')
      .populate('classTeacher', 'firstName lastName');
    res.json(classes);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Get single class with populated students, teacher and subject teachers
router.get('/:id', auth, async (req, res) => {
  try {
    const c = await ClassModel.findById(req.params.id)
      .populate('students', 'firstName lastName rollNumber')
      .populate('subjects.teachers', 'firstName lastName')
      .populate('classTeacher', 'firstName lastName');
    if (!c) return res.status(404).json({ message: 'Not found' });
    res.json(c);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Grade mapping for promotion logic
const GRADE_ORDER = {
  'Nursery': 0, 'LKG': 1, 'UKG': 2,
  '1': 3, '2': 4, '3': 5, '4': 6, '5': 7,
  '6': 8, '7': 9, '8': 10, '9': 11, '10': 12,
  '11': 13, '12': 14
};

// Create class (supports optional subjects with assigned teacher ids)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    let { name, subjects, classTeacher, grade, section } = req.body;

    // Construct name from grade/section if provided
    let promotionOrder;
    if (grade && section) {
      // e.g. "1 A" or "Nursery A"
      const formattedName = `${grade} ${section}`;
      if (!name) name = formattedName; // use generated name if not explicitly provided
      if (grade in GRADE_ORDER) promotionOrder = GRADE_ORDER[grade];
    }

    if (!name) return res.status(400).json({ message: 'Name required' });
    const exists = await ClassModel.findOne({ name });
    if (exists) return res.status(400).json({ message: 'Class with that name already exists' });

    const classDoc = new ClassModel({ name, grade, section, promotionOrder });
    if (classTeacher) classDoc.classTeacher = classTeacher;

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
    const populated = await ClassModel.findById(classDoc._id)
      .populate('subjects.teachers', 'firstName lastName')
      .populate('classTeacher', 'firstName lastName');
    res.json(populated);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Promote students to next class
router.post('/promote', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

  // Transactions only work on Replica Sets. For standalone/local dev, we must use sequential operations.
  // Use a simple try-catch block without session.
  try {
    // Fetch all classes with promotion info
    const classes = await ClassModel.find({ promotionOrder: { $exists: true }, section: { $exists: true } })
      .sort({ promotionOrder: -1 }); // Process highest grades first (e.g. 11->12, then 10->11)

    const logs = [];

    for (const currentClass of classes) {
      const nextOrder = currentClass.promotionOrder + 1;
      // Find target class (same section, next order)
      // e.g. "5 A" -> "6 A"
      const targetClass = await ClassModel.findOne({
        promotionOrder: nextOrder,
        section: currentClass.section
      });

      if (targetClass) {
        // Move students
        const studentsToMove = currentClass.students;
        if (!studentsToMove || studentsToMove.length === 0) continue;

        // 1. Update students to point to new class
        await Student.updateMany(
          { _id: { $in: studentsToMove } },
          { class: targetClass._id }
        );

        // 2. Add to target class
        await ClassModel.findByIdAndUpdate(targetClass._id, {
          $push: { students: { $each: studentsToMove } }
        });

        // 3. Clear from current class
        await ClassModel.findByIdAndUpdate(currentClass._id, {
          $set: { students: [] }
        });

        logs.push(`Promoted ${studentsToMove.length} students from ${currentClass.name} to ${targetClass.name}`);
      } else {
        // No target class found
        // Check if it is the graduating class (12th)
        if (currentClass.grade === '12') {
          const studentsToMove = currentClass.students;
          if (studentsToMove.length > 0) {
            // "Graduate" them: remove class assignment
            // Ideally we could set a status="alumni", but for now unsetting class is sufficient.
            await Student.updateMany(
              { _id: { $in: studentsToMove } },
              { $unset: { class: 1 } }
            );
            await ClassModel.findByIdAndUpdate(currentClass._id, { $set: { students: [] } });
            logs.push(`Graduated (Passout) ${studentsToMove.length} students from ${currentClass.name}`);
          }
        } else {
          if (currentClass.students.length > 0) {
            logs.push(`Skipped ${currentClass.name}: Next class (Grade Order ${nextOrder}, Section ${currentClass.section}) not found.`);
          }
        }
      }
    }
    res.json({ message: 'Promotion completed', logs });
  } catch (err) {
    console.error('Promotion error:', err);
    res.status(500).json({ message: 'Promotion failed', error: err.message });
  }
});

// Update class: assign teacher, students, and subjects
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { studentIds, subjects, classTeacher } = req.body; // studentIds: array, subjects: [{ name, teacherIds }]
    const classId = req.params.id;
    const update = {};
    if (classTeacher !== undefined) update.classTeacher = classTeacher; // allow unsetting if null passed? usually client sends null or id

    if (studentIds) {
      // Validate student ids
      const students = await Student.find({ _id: { $in: studentIds } });
      if (students.length !== studentIds.length) return res.status(400).json({ message: 'One or more studentIds invalid' });

      // Identify added and removed students
      const currentClass = await ClassModel.findById(classId);
      if (!currentClass) return res.status(404).json({ message: 'Class not found' });

      // We cannot easily compare object IDs from string array vs DB array efficiently without casting
      // Simpler approach: 
      // 1. Remove this class from 'class' field of students currently in this class but NOT in new list
      // 2. Set 'class' field to this class for ALL students in new list
      // 3. For students in new list, if they were in ANOTHER class, remove them from that class's students array

      // 1. Handle removals
      const currentStudentIds = currentClass.students.map(s => s.toString());
      const newStudentIds = studentIds.map(s => s.toString());

      const removedIds = currentStudentIds.filter(id => !newStudentIds.includes(id));
      if (removedIds.length > 0) {
        await Student.updateMany(
          { _id: { $in: removedIds } },
          { $unset: { class: 1 } }
        );
      }

      // 2 & 3. Handle additions/updates
      // For every student in the new list, we must ensure they belong to THIS class.
      // If they belonged to another class, we need to remove them from that class.
      // Doing this one-by-one is safest to maintain integrity of other Class documents.

      for (const sId of newStudentIds) {
        const s = await Student.findById(sId);
        if (s && s.class && s.class.toString() !== classId) {
          // Student was in another class (s.class). Remove them from that class's collection.
          await ClassModel.findByIdAndUpdate(s.class, { $pull: { students: sId } });
        }
      }

      // Bulk update all new students to point to this class
      await Student.updateMany(
        { _id: { $in: newStudentIds } },
        { class: classId }
      );

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

    const c = await ClassModel.findByIdAndUpdate(classId, update, { new: true })
      .populate('students', 'firstName lastName')
      .populate('subjects.teachers', 'firstName lastName')
      .populate('classTeacher', 'firstName lastName');
    if (!c) return res.status(404).json({ message: 'Not found' });
    res.json(c);
  } catch (err) { console.error(err); res.status(400).json({ message: 'Bad request', error: err.message }); }
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
