const mongoose = require('mongoose');

const DriverSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  // optional reference to an authentication user
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  licenseNumber: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Driver', DriverSchema);
