const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Bus = require('../models/Bus');
const auth = require('../middleware/auth');

// Get driver profile by logged-in user
router.get('/me', auth, async (req, res) => {
  try {
    // Try to find driver by linked userId first
    let driver = await Driver.findOne({ userId: req.user.id });

    // Fallbacks: find by email, phone or licenseNumber matching user's info
    if (!driver) {
      const candidates = [];
      if (req.user.email) candidates.push({ email: req.user.email });
      if (req.user.username) {
        candidates.push({ phone: req.user.username });
        candidates.push({ licenseNumber: req.user.username });
      }
      if (candidates.length) {
        driver = await Driver.findOne({ $or: candidates });
        // If we found a driver without userId, link it to this user for future convenience
        if (driver && !driver.userId) {
          try {
            driver.userId = req.user.id;
            await driver.save();
          } catch (e) { console.warn('Failed to link driver to user:', e.message); }
        }
      }
    }

    if (!driver) return res.status(404).json({ message: 'Driver profile not found' });
    // find assigned bus and populate route with stops and students
    const bus = await Bus.findOne({ driver: driver._id }).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    res.json({ driver, bus, route: bus ? bus.route : null });
  } catch (err) { console.error('GET /driver/me error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Driver starts a ride: mark bus.live.active = true and optionally set initial location
router.post('/ride/start', auth, async (req, res) => {
  try {
    // ensure caller is a driver-linked user
    let driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found for user' });

    const { lat, lng } = req.body || {};
    const update = {
      'live.active': true,
      'live.startedAt': new Date(),
      'live.updatedAt': new Date()
    };
    if (lat != null && lng != null) update['live.lastLocation'] = { lat: Number(lat), lng: Number(lng) };

    const updated = await Bus.findOneAndUpdate({ driver: driver._id }, { $set: update }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No bus assigned to driver' });
    return res.json({ live: updated.live });
  } catch (err) {
    console.error('POST /driver/ride/start error:', err);
    // include error message to help debugging during development
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Driver stops a ride: mark inactive but keep lastLocation
router.post('/ride/stop', auth, async (req, res) => {
  try {
    let driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found for user' });
    const updated = await Bus.findOneAndUpdate({ driver: driver._id }, { $set: { 'live.active': false, 'live.updatedAt': new Date() } }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No bus assigned to driver' });
    return res.json({ live: updated.live });
  } catch (err) {
    console.error('POST /driver/ride/stop error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Driver updates location while ride is active
router.post('/ride/location', auth, async (req, res) => {
  try {
    let driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found for user' });
    const { lat, lng } = req.body || {};
    if (lat == null || lng == null) return res.status(400).json({ message: 'lat and lng required' });
    const update = { 'live.lastLocation': { lat: Number(lat), lng: Number(lng) }, 'live.updatedAt': new Date() };
    const updated = await Bus.findOneAndUpdate({ driver: driver._id }, { $set: update }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No bus assigned to driver' });
    return res.json({ live: updated.live });
  } catch (err) {
    console.error('POST /driver/ride/location error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
