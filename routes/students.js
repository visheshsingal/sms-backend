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

const cloudinary = require('../utils/cloudinary');
const multer = require('multer');
const fs = require('fs');
const upload = multer({ dest: 'uploads/' });

// Create student (admin only)
router.post('/', auth, upload.single('profileImage'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    let { username, password, ...studentData } = req.body;

    // Process image if present
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'students_profile',
          width: 300,
          height: 300,
          crop: 'fill'
        });
        studentData.profileImage = result.secure_url;
        fs.unlinkSync(req.file.path);
      } catch (uploadErr) {
        console.error('Cloudinary upload failed:', uploadErr);
        // Optionally fail or proceed without image? Let's proceed but warn.
        // Or better, fail to notify user.
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ message: 'Image upload failed', error: uploadErr.message });
      }
    }

    // If admin provided a password but no username, try to derive a safe username
    if (password && !username) {
      if (studentData.email) {
        username = (studentData.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
      }
    }

    const mongoose = require('mongoose')
    const Class = require('../models/Class')

    // Sanitize empty fields
    if (studentData.class === '' || studentData.class === 'null') delete studentData.class;
    if (!studentData.rollNumber) delete studentData.rollNumber;
    if (!studentData.phone) delete studentData.phone;
    if (!studentData.email) delete studentData.email;

    // New fields sanitization
    if (!studentData.admissionNumber) delete studentData.admissionNumber;
    if (!studentData.aadharCard) delete studentData.aadharCard;

    if (studentData.class && typeof studentData.class === 'string') {
      if (!mongoose.Types.ObjectId.isValid(studentData.class)) {
        const cls = await Class.findOne({ name: studentData.class });
        if (cls) {
          studentData.class = cls._id
        } else {
          console.warn(`Class name not found: ${studentData.class}`)
          studentData.class = undefined
        }
      }
    }

    // Basic validation
    if (!studentData.firstName || !studentData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });
    if (!studentData.admissionNumber) return res.status(400).json({ message: 'Admission Number is required' });
    if (!studentData.admissionDate) return res.status(400).json({ message: 'Admission Date is required' });
    if (!studentData.fatherName) return res.status(400).json({ message: 'Father Name is required' });
    if (!studentData.aadharCard) return res.status(400).json({ message: 'Aadhar Card Number is required' });


    const s = new Student({ ...studentData });
    try {
      await s.save();
      // QR Generation
      try {
        const token = crypto.randomBytes(16).toString('hex');
        const issuedAt = new Date();
        const expires = new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
        s.qrToken = token;
        s.qrTokenIssuedAt = issuedAt;
        s.qrTokenExpires = expires;
        await s.save();
      } catch (qtErr) { console.warn('QR Gen failed', qtErr.message); }

      // Add to Class
      if (s.class) {
        try {
          await Class.findByIdAndUpdate(s.class, { $addToSet: { students: s._id } });
        } catch (cu) { console.warn('Failed to add to class', cu.message) }
      }
    } catch (err) {
      console.error('Error saving student:', err);
      if (err.code === 11000) {
        // Handle duplicate key errors cleanly
        const field = Object.keys(err.keyPattern)[0];
        return res.status(400).json({ message: `Duplicate value for ${field}`, error: err.message });
      }
      return res.status(400).json({ message: 'Failed to create student', error: err.message, details: err.errors || null });
    }


    // User creation logic
    let user = null;
    if (username || password) {
      if (!username || !password) {
        await Student.findByIdAndDelete(s._id).catch(() => { });
        return res.status(400).json({ message: 'Both username and password are required for login creation.' });
      }
      const exists = await User.findOne({ username });
      if (exists) {
        if (exists.role === 'student') {
          user = exists;
        } else {
          await Student.findByIdAndDelete(s._id).catch(() => { });
          return res.status(400).json({ message: 'Username already taken' });
        }
      } else {
        try {
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'student', email: studentData.email || `${username}@noemail.local` });
          await user.save();
        } catch (uerr) {
          console.error('Error creating user:', uerr);
          await Student.findByIdAndDelete(s._id).catch(() => { });
          return res.status(500).json({ message: 'Failed to create associated user', error: uerr.message });
        }
      }

      s.userId = user._id;
      try { await s.save(); } catch (err) {
        // Attach failed
        if (!exists) await User.findByIdAndDelete(user._id).catch(() => { });
        await Student.findByIdAndDelete(s._id).catch(() => { });
        return res.status(500).json({ message: 'Failed to link user to student', error: err.message });
      }
    }

    res.json(s);
  } catch (err) {
    console.error('Error creating student:', err);
    res.status(400).json({ message: 'Bad request', error: err.message });
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
// Update student
router.put('/:id', auth, upload.single('profileImage'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { username, password, ...update } = req.body;

    // Process image if present
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'students_profile',
          width: 300,
          height: 300,
          crop: 'fill'
        });
        update.profileImage = result.secure_url;
        fs.unlinkSync(req.file.path);
      } catch (uploadErr) {
        console.error('Cloudinary update failed:', uploadErr);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ message: 'Image upload failed' });
      }
    }

    if (update.class === '' || update.class === 'null') delete update.class;

    const mongoose = require('mongoose')
    const Class = require('../models/Class')

    if (update.class && typeof update.class === 'string' && !mongoose.Types.ObjectId.isValid(update.class)) {
      const cls = await Class.findOne({ name: update.class })
      if (cls) update.class = cls._id
    }

    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Not found' });

    // Handle username/password updates
    if (username || password) {
      let user = null;
      if (student.userId) user = await User.findById(student.userId);

      if (username) {
        const existing = await User.findOne({ username });
        if (existing && (!user || existing._id.toString() !== user._id.toString())) {
          return res.status(400).json({ message: 'Username already taken' });
        }
        if (user) {
          user.username = username;
        } else {
          if (!password) return res.status(400).json({ message: 'Password required when creating new user' });
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'student', email: student.email || `${username}@noemail.local` });
          await user.save();
          student.userId = user._id;
        }
      }

      if (password && user) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }

      if (user) await user.save();
    }

    Object.assign(student, update);
    await student.save();
    res.json(student);
  } catch (err) {
    console.error('Update student error:', err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({ message: `Duplicate value for ${field}`, error: err.message });
    }
    res.status(400).json({ message: 'Bad request', error: err.message });
  }
});

// Delete student
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const Class = require('../models/Class');
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Not found' });
    // if linked user exists, delete it
    if (student.userId) {
      await User.findByIdAndDelete(student.userId);
    }
    // remove from class.students if present
    if (student.class) {
      try { await Class.findByIdAndUpdate(student.class, { $pull: { students: student._id } }); } catch (e) { console.warn('Failed removing student from class:', e.message) }
    }
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
