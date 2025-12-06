const mongoose = require('mongoose');

const TimetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  content: { type: String },
  imageUrl: { type: String },
  date: { type: Date },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Timetable', TimetableSchema);
