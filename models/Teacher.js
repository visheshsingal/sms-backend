const mongoose = require('mongoose');

const TeacherSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  // optional reference to an authentication user
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  employeeId: { type: String, unique: true, sparse: true },
  department: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Teacher', TeacherSchema);
