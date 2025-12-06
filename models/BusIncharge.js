const mongoose = require('mongoose');

const BusInchargeSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    // optional reference to an authentication user
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BusIncharge', BusInchargeSchema);
