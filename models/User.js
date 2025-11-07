const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  // store email so we can avoid duplicate-null index problems in the DB
  email: { type: String, required: false },
  passwordHash: { type: String, required: true },
  // include 'driver' so driver accounts can be created without validation errors
  role: { type: String, enum: ['admin', 'student', 'teacher', 'driver'], required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
