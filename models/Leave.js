const mongoose = require('mongoose');

const LeaveSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  reason: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  history: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['student', 'teacher', 'admin'] },
    message: { type: String },
    date: { type: Date, default: Date.now },
    action: { type: String } // 'applied', 'approved', 'rejected', 'reapplied'
  }]
}, { timestamps: true });

module.exports = mongoose.model('Leave', LeaveSchema);
