const mongoose = require('mongoose');

const StopSchema = new mongoose.Schema({
  address: { type: String, required: true },
  // optional absolute time for this stop (HH:MM). If provided, this is used
  // instead of estimatedMinutes. Stored as string in 24-hour format.
  time: { type: String },
  // estimated time at this stop relative to start (minutes)
  estimatedMinutes: { type: Number, default: 0 },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
});

const RouteSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startTime: { type: String, required: true }, // store as HH:MM
  endTime: { type: String }, // optional end time (HH:MM) to form a timeslot
  startLocation: { type: String },
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus' },
  stops: [StopSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Route', RouteSchema);
