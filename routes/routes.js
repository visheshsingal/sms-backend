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

// helper to convert HH:MM -> minutes since midnight
function timeToMinutes(t) {
  if (!t) return null
  const [hh, mm] = String(t).split(':').map(Number)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  return hh * 60 + mm
}

// Create a route
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { name, startTime, endTime, startLocation, bus: busId, stops } = req.body;
    if (!name || !startTime) return res.status(400).json({ message: 'name and startTime required' });

    const route = new RouteModel({ name, startTime, endTime: endTime || null, startLocation });

    // if a bus is assigned, require endTime and validate no overlap
    if (busId) {
      if (!endTime) return res.status(400).json({ message: 'endTime required when assigning a bus' });
      if (!/^[0-9a-fA-F]{24}$/.test(String(busId))) return res.status(400).json({ message: 'Invalid bus id' });
      const bus = await Bus.findById(busId);
      if (!bus) return res.status(400).json({ message: 'Invalid bus id' });

      // check for overlapping routes for this bus
      const s1 = timeToMinutes(startTime)
      const e1 = timeToMinutes(endTime)
      if (s1 === null || e1 === null || e1 <= s1) return res.status(400).json({ message: 'Invalid startTime/endTime range' });
      const conflicts = await RouteModel.find({ bus: bus._id });
      for (const c of conflicts) {
        if (!c.startTime || !c.endTime) continue
        const s2 = timeToMinutes(c.startTime)
        const e2 = timeToMinutes(c.endTime)
        if (s1 < e2 && s2 < e1) return res.status(400).json({ message: `Bus already assigned to route '${c.name}' in overlapping timeslot` })
      }

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
    // if a bus was assigned, set the bus.route pointer for convenience
    if (route.bus) {
      try { await Bus.findByIdAndUpdate(route.bus, { route: route._id }) } catch (e) { /* ignore */ }
    }
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
  const prior = await RouteModel.findById(req.params.id)
  const { name, startTime, endTime, startLocation, bus: busId, stops } = req.body;
    const update = {};
    if (name) update.name = name;
    if (startTime) update.startTime = startTime;
    if (endTime) update.endTime = endTime;
    if (startLocation) update.startLocation = startLocation;
    if (busId) {
      if (busId === '' || busId === null) {
        update.bus = null
      } else {
        if (!/^[0-9a-fA-F]{24}$/.test(String(busId))) return res.status(400).json({ message: 'Invalid bus id' });
        const bus = await Bus.findById(busId);
        if (!bus) return res.status(400).json({ message: 'Invalid bus id' });

        // when assigning a bus, ensure we have endTime and no conflicts
        const s1 = timeToMinutes(startTime || (await RouteModel.findById(req.params.id)).startTime)
        const e1 = timeToMinutes(endTime || (await RouteModel.findById(req.params.id)).endTime)
        if (s1 === null || e1 === null || e1 <= s1) return res.status(400).json({ message: 'Invalid startTime/endTime range' });
        const conflicts = await RouteModel.find({ _id: { $ne: req.params.id }, bus: bus._id });
        for (const c of conflicts) {
          if (!c.startTime || !c.endTime) continue
          const s2 = timeToMinutes(c.startTime)
          const e2 = timeToMinutes(c.endTime)
          if (s1 < e2 && s2 < e1) return res.status(400).json({ message: `Bus already assigned to route '${c.name}' in overlapping timeslot` })
        }
        update.bus = bus._id;
      }
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
    // maintain bus.route pointer: if bus changed, update pointers
    try {
      if (update.bus !== undefined) {
        // unset prior bus.route
        if (prior && prior.bus && (!r.bus || String(prior.bus) !== String(r.bus._id))) {
          await Bus.findByIdAndUpdate(prior.bus, { $unset: { route: '' } })
        }
        if (r.bus) await Bus.findByIdAndUpdate(r.bus._id, { route: r._id })
      }
    } catch (e) { /* ignore */ }
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
