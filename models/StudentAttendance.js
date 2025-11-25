const mongoose = require('mongoose');

const StudentAttendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: false },
  scannerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  scannerRole: { type: String, enum: ['teacher','driver','admin','other'], required: false },
  type: { type: String, default: 'daily' },
  timestamp: { type: Date, default: Date.now },
  rawPayload: { type: Object, required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('StudentAttendance', StudentAttendanceSchema);

