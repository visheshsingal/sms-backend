const express = require('express');
const router = express.Router();
const RouteModel = require('../models/Route');
const Bus = require('../models/Bus');
const Student = require('../models/Student');
const auth = require('../middleware/auth');

// List routes (admin)
router.get('/', auth, async (req, res) => {
  try {
    const routes = await RouteModel.find().sort({ createdAt: -1 }).populate('bus', 'number').populate('stops.students', 'firstName lastName');
    res.json(routes);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create a route
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name, startTime, startLocation, bus: busId, stops } = req.body;
    if (!name || !startTime) return res.status(400).json({ message: 'name and startTime required' });

    const route = new RouteModel({ name, startTime, startLocation });

    if (busId && /^[0-9a-fA-F]{24}$/.test(String(busId))) {
      const bus = await Bus.findById(busId);
      if (!bus) return res.status(400).json({ message: 'Invalid bus id' });
      route.bus = bus._id;
    }

    // stops: [{ address, time (HH:MM), estimatedMinutes, students: [ids] }]
    if (Array.isArray(stops)) {
      const cleaned = [];
      for (const s of stops) {
        if (!s || !s.address) continue;
        const stop = { address: s.address, estimatedMinutes: s.estimatedMinutes || 0 };
        if (s.time) stop.time = s.time;
        if (Array.isArray(s.students) && s.students.length) {
          const students = await Student.find({ _id: { $in: s.students } });
          if (students.length !== s.students.length) return res.status(400).json({ message: `Invalid student ids for stop ${s.address}` });
          stop.students = s.students;
        }
        cleaned.push(stop);
      }
      route.stops = cleaned;
    }

    await route.save();
    const populated = await RouteModel.findById(route._id).populate('bus', 'number').populate('stops.students', 'firstName lastName');
    res.json(populated);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Get single route
router.get('/:id', auth, async (req, res) => {
  try {
    const r = await RouteModel.findById(req.params.id).populate('bus', 'number').populate('stops.students', 'firstName lastName');
    if (!r) return res.status(404).json({ message: 'Not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update route
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name, startTime, startLocation, bus: busId, stops } = req.body;
    const update = {};
    if (name) update.name = name;
    if (startTime) update.startTime = startTime;
    if (startLocation) update.startLocation = startLocation;
    if (busId && /^[0-9a-fA-F]{24}$/.test(String(busId))) {
      const bus = await Bus.findById(busId);
      if (!bus) return res.status(400).json({ message: 'Invalid bus id' });
      update.bus = bus._id;
    }

    if (Array.isArray(stops)) {
      const cleaned = [];
      for (const s of stops) {
        if (!s || !s.address) continue;
        const stop = { address: s.address, estimatedMinutes: s.estimatedMinutes || 0 };
        if (s.time) stop.time = s.time;
        if (Array.isArray(s.students) && s.students.length) {
          const students = await Student.find({ _id: { $in: s.students } });
          if (students.length !== s.students.length) return res.status(400).json({ message: `Invalid student ids for stop ${s.address}` });
          stop.students = s.students;
        }
        cleaned.push(stop);
      }
      update.stops = cleaned;
    }

    const r = await RouteModel.findByIdAndUpdate(req.params.id, update, { new: true }).populate('bus', 'number').populate('stops.students', 'firstName lastName');
    if (!r) return res.status(404).json({ message: 'Not found' });
    res.json(r);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete route
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    await RouteModel.findByIdAndDelete(req.params.id);
    // unset route field on any bus that referenced this route
    await Bus.updateMany({ route: req.params.id }, { $unset: { route: '' } });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
