const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  // subjects taught in this class. Each subject can have multiple assigned teachers.
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  subjects: [
    {
      name: { type: String, required: true },
      teachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' }]
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Class', ClassSchema);
