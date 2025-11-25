const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const crypto = require('crypto');
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
    let { username, password, ...studentData } = req.body;

    // If admin provided a password but no username, try to derive a safe username
    // from the student's email local-part so admins can create login using only email+password.
    if (password && !username) {
      if (studentData.email) {
        username = (studentData.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
      }
    }

    // If `class` is provided as a name (string) try to resolve to Class._id
    // Also sanitize empty strings so Mongoose doesn't attempt to cast "" to ObjectId
    const mongoose = require('mongoose')
    const Class = require('../models/Class')
    if (studentData.class === '') {
      // treat empty string as no class selected
      delete studentData.class
    }
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
      // generate a QR token automatically when a student is created
      try {
        const token = crypto.randomBytes(16).toString('hex');
        const issuedAt = new Date();
        const expires = new Date(issuedAt.getTime() + 365*24*60*60*1000);
        s.qrToken = token;
        s.qrTokenIssuedAt = issuedAt;
        s.qrTokenExpires = expires;
        await s.save();
      } catch (qtErr) {
        console.warn('Failed to auto-generate QR token for student:', qtErr.message);
      }
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

    // If username/password provided (or password provided and username derived), create or link User and attach to student
    let user = null;
    if (username || password) {
      if (!username || !password) {
        // cleanup created student
        await Student.findByIdAndDelete(s._id).catch(()=>{});
        return res.status(400).json({ message: 'Both username and password are required to create a login for student. Provide an email or username and a password.' });
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
          user = new User({ username, passwordHash: hash, role: 'student', email: studentData.email || `${username}@noemail.local` });
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
    // allow updating username/password for the linked User account
  const { username, password, ...update } = req.body;
  // sanitize empty class values to avoid ObjectId cast errors
  if (update.class === '') delete update.class;
    const mongoose = require('mongoose')
    const Class = require('../models/Class')
    if (update.class && typeof update.class === 'string' && !mongoose.Types.ObjectId.isValid(update.class)){
      const cls = await Class.findOne({ name: update.class })
      if (cls) update.class = cls._id
    }

    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Not found' });

    // Handle username/password updates
    if (username || password) {
      let user = null;
      if (student.userId) user = await User.findById(student.userId);

      // If username provided, ensure it's not taken by another user
          if (username) {
        const existing = await User.findOne({ username });
        if (existing && (!user || existing._id.toString() !== user._id.toString())) {
          return res.status(400).json({ message: 'Username already taken' });
        }
        if (user) {
          user.username = username;
        } else {
          // creating a new user for this student requires a password
          if (!password) return res.status(400).json({ message: 'Password required when creating new user' });
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'student', email: student.email || `${username}@noemail.local` });
          await user.save();
          student.userId = user._id;
        }
      }

      // If password provided and user exists, update it
      if (password && user) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }

      if (user) await user.save();
    }

    // Apply other updates to the student document
    Object.assign(student, update);
    await student.save();
    res.json(student);
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
