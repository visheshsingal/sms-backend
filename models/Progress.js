const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  date: { type: Date, default: Date.now },
  // Structured exam fields
  examName: { type: String },
  subject: { type: String },
  marks: { type: Number },
  outOf: { type: Number },
  absent: { type: Boolean, default: false },
  // Keep metrics for backward-compatibility
  metrics: { type: mongoose.Schema.Types.Mixed },
  remarks: { type: String }
});

module.exports = mongoose.model('Progress', ProgressSchema);
