const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  // subjects taught in this class. Each subject can have multiple assigned teachers.
  classTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  subjects: [
    {
      name: { type: String, required: true },
      teachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' }]
    }
  ],
  grade: { type: String }, // e.g., 'Nursery', 'LKG', '1', '10'
  section: { type: String }, // e.g., 'A', 'B'
  promotionOrder: { type: Number }, // e.g., 0 for Nursery, 1 for LKG, 3 for 1st, etc.
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Class', ClassSchema);
