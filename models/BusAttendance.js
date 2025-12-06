const mongoose = require('mongoose');

const BusAttendanceSchema = new mongoose.Schema({
  busId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  date: { type: Date, required: true },
  session: { type: String, enum: ['morning', 'evening'], required: true, default: 'morning' }, // Default to morning for migration
  records: [{ studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' }, status: { type: String, enum: ['present', 'absent'], default: 'present' } }],
  createdAt: { type: Date, default: Date.now }
});

BusAttendanceSchema.index({ busId: 1, date: 1, session: 1 }, { unique: true });

module.exports = mongoose.model('BusAttendance', BusAttendanceSchema);
