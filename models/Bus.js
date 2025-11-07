const mongoose = require('mongoose');

const BusSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  // reference to route document (if assigned)
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  capacity: { type: Number, default: 20 },
  // assigned driver
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: false },
  // live ride state (updated by driver when sharing location)
  live: {
    active: { type: Boolean, default: false },
    startedAt: { type: Date },
    lastLocation: {
      lat: { type: Number },
      lng: { type: Number }
    },
    updatedAt: { type: Date }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bus', BusSchema);
