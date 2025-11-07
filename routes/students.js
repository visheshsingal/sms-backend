const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// List students (admin-protected)
router.get('/', auth, async (req, res) => {
  try {
    // populate class so admin UI can show class.name instead of raw id
    const students = await Student.find().sort({ createdAt: -1 }).populate('class', 'name');
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Create student (admin only)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    // Accept optional username/password for student auth account.
    // If provided, create a User; otherwise create Student without userId.
    const { username, password, ...studentData } = req.body;

    // If `class` is provided as a name (string) try to resolve to Class._id
    const mongoose = require('mongoose')
    const Class = require('../models/Class')
    if (studentData.class && typeof studentData.class === 'string'){
      if (!mongoose.Types.ObjectId.isValid(studentData.class)){
        // try to find class by name
        const cls = await Class.findOne({ name: studentData.class });
        if (cls) {
          studentData.class = cls._id
        } else {
          // couldn't resolve class name -> clear it to avoid CastError; admin can set later via edit
          console.warn(`Class name not found when creating student: ${studentData.class} - clearing field`)
          studentData.class = undefined
        }
      }
    }

    // Basic validation for required student fields to give clearer errors
    if (!studentData.firstName || !studentData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });

    // Create the Student first (without userId). This avoids creating a User and then failing to save Student
    const s = new Student({ ...studentData });
    try {
      await s.save();
      // If student has a class, ensure the class document references this student
      if (s.class) {
        try{
          await Class.findByIdAndUpdate(s.class, { $addToSet: { students: s._id } });
        }catch(cu){ console.warn('Failed to add student to class.students:', cu.message) }
      }
    } catch (err){
      console.error('Error saving student:', err);
      return res.status(400).json({ message: 'Failed to create student', error: err.message, details: err.errors || null });
    }

    // If username/password provided, create or link User and attach to student
    let user = null;
    if (username || password) {
      if (!username || !password) {
        // cleanup created student
        await Student.findByIdAndDelete(s._id).catch(()=>{});
        return res.status(400).json({ message: 'Both username and password are required to create a login for student' });
      }
      const exists = await User.findOne({ username });
      if (exists) {
        if (exists.role === 'student') {
          user = exists;
        } else {
          // cleanup created student
          await Student.findByIdAndDelete(s._id).catch(()=>{});
          return res.status(400).json({ message: 'Username already taken' });
        }
      } else {
        try {
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'student', email: `${username}@noemail.local` });
          await user.save();
        } catch (uerr) {
          console.error('Error creating user for student:', uerr);
          // cleanup created student
          await Student.findByIdAndDelete(s._id).catch(()=>{});
          return res.status(500).json({ message: 'Failed to create associated user', error: uerr.message });
        }
      }

      // attach userId to student and save
      s.userId = user._id;
      try { await s.save(); } catch(err){
        console.error('Error attaching userId to student:', err);
        // attempt cleanup: delete user if we created it
        if (!exists) await User.findByIdAndDelete(user._id).catch(()=>{});
        await Student.findByIdAndDelete(s._id).catch(()=>{});
        return res.status(500).json({ message: 'Failed to link user to student', error: err.message });
      }
    }

    res.json(s);
  } catch (err) {
    console.error('Error creating student:', err);
    // include more details to help debugging in dev
    res.status(400).json({ message: 'Bad request', error: err.message, name: err.name, details: err.errors || null });
  }
});

// Get single student
router.get('/:id', auth, async (req, res) => {
  try {
    const s = await Student.findById(req.params.id);
    if (!s) return res.status(404).json({ message: 'Not found' });
    res.json(s);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update student
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    // if updating class by name, resolve it
    const update = { ...req.body }
    const mongoose = require('mongoose')
    const Class = require('../models/Class')
    if (update.class && typeof update.class === 'string' && !mongoose.Types.ObjectId.isValid(update.class)){
      const cls = await Class.findOne({ name: update.class })
      if (cls) update.class = cls._id
    }
    const s = await Student.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!s) return res.status(404).json({ message: 'Not found' });
    res.json(s);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete student
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Not found' });
    // if linked user exists, delete it
    if (student.userId){
      await User.findByIdAndDelete(student.userId);
    }
    // remove from class.students if present
    if (student.class){
      try{ await Class.findByIdAndUpdate(student.class, { $pull: { students: student._id } }); }catch(e){ console.warn('Failed removing student from class:', e.message) }
    }
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
