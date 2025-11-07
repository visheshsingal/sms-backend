const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Driver = require('../models/Driver');
const auth = require('../middleware/auth');

// List buses
router.get('/', auth, async (req, res) => {
  try {
    const buses = await Bus.find().sort({ createdAt: -1 })
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    res.json(buses);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create bus (admin only)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { driver, ...busData } = req.body;
    const b = new Bus({ ...busData });

    // resolve driver if provided (accept id or username)
    if (driver) {
      let drv = null;
      if (typeof driver === 'string') {
        if (/^[0-9a-fA-F]{24}$/.test(driver)) drv = await Driver.findById(driver);
        if (!drv) drv = await Driver.findOne({ licenseNumber: driver }) || await Driver.findOne({ phone: driver });
      } else if (typeof driver === 'object' && driver._id) {
        drv = await Driver.findById(driver._id);
      }
      if (drv) b.driver = drv._id;
    }

    // accept route id (optional)
    if (req.body.route && /^[0-9a-fA-F]{24}$/.test(String(req.body.route))) {
      b.route = req.body.route
    }
    await b.save();
    res.json(await Bus.findById(b._id)
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } }));
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Get single
router.get('/:id', auth, async (req, res) => {
  try {
    const b = await Bus.findById(req.params.id)
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    if (!b) return res.status(404).json({ message: 'Not found' });
    res.json(b);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Get live ride state for a bus
router.get('/:id/live', auth, async (req, res) => {
  try {
    const b = await Bus.findById(req.params.id).select('live');
    if (!b) return res.status(404).json({ message: 'Not found' });
    res.json({ live: b.live || { active: false } });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update bus
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const update = { ...req.body };
    if (update.driver) {
      let drv = null;
      if (typeof update.driver === 'string') {
        if (/^[0-9a-fA-F]{24}$/.test(update.driver)) drv = await Driver.findById(update.driver);
        if (!drv) drv = await Driver.findOne({ licenseNumber: update.driver }) || await Driver.findOne({ phone: update.driver });
      } else if (typeof update.driver === 'object' && update.driver._id) {
        drv = await Driver.findById(update.driver._id);
      }
      update.driver = drv ? drv._id : undefined;
    }

    const b = await Bus.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    if (!b) return res.status(404).json({ message: 'Not found' });
    res.json(b);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete bus
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ message: 'Not found' });
    await Bus.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
