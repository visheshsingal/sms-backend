const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  // reference to an authentication user (optional)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  rollNumber: { type: String, unique: true, sparse: true },
  // reference to Class model
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);
