const mongoose = require('mongoose');

const NoticeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // audience values: all, students, teachers, admins, drivers, bus-incharges
  audience: { type: String, enum: ['all', 'students', 'teachers', 'admins', 'drivers', 'bus-incharges'], default: 'all' },
  targetClass: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }, // If set, only for this class
  targetStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' }, // If set, only for this student
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notice', NoticeSchema);
