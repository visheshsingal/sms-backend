const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Bus = require('../models/Bus');
const auth = require('../middleware/auth');
const BusAttendance = require('../models/BusAttendance');
const StudentAttendance = require('../models/StudentAttendance');
const Student = require('../models/Student');

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
    // find assigned buses (driver may be assigned multiple buses)
    const buses = await Bus.find({ driver: driver._id })
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber class' } });
    // if exactly one bus, include route top-level for convenience
    res.json({ driver, buses, route: buses && buses.length === 1 ? buses[0].route : null });
  } catch (err) { console.error('GET /driver/me error:', err); res.status(500).json({ message: 'Server error' }); }
});

// Driver starts a ride: mark bus.live.active = true and optionally set initial location
router.post('/ride/start', auth, async (req, res) => {
  try {
    // ensure caller is a driver-linked user
    let driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found for user' });

    const { lat, lng, busId } = req.body || {};
    const update = {
      'live.active': true,
      'live.startedAt': new Date(),
      'live.updatedAt': new Date()
    };
    if (lat != null && lng != null) update['live.lastLocation'] = { lat: Number(lat), lng: Number(lng) };

    // If busId provided, ensure driver owns that bus
    let query = { driver: driver._id };
    if (busId) {
      if (!busId || !/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      query = { _id: busId, driver: driver._id };
    }

    const updated = await Bus.findOneAndUpdate(query, { $set: update }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No matching bus assigned to driver' });
    return res.json({ live: updated.live, busId: updated._id });
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
    const { busId } = req.body || {};
    let query = { driver: driver._id };
    if (busId) {
      if (!busId || !/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      query = { _id: busId, driver: driver._id };
    }
    const updated = await Bus.findOneAndUpdate(query, { $set: { 'live.active': false, 'live.updatedAt': new Date() } }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No matching bus assigned to driver' });
    return res.json({ live: updated.live, busId: updated._id });
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
    const { busId } = req.body || {};
    const update = { 'live.lastLocation': { lat: Number(lat), lng: Number(lng) }, 'live.updatedAt': new Date() };
    let query = { driver: driver._id };
    if (busId) {
      if (!busId || !/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      query = { _id: busId, driver: driver._id };
    }
    const updated = await Bus.findOneAndUpdate(query, { $set: update }, { new: true }).select('live');
    if (!updated) return res.status(400).json({ message: 'No matching bus assigned to driver' });
    return res.json({ live: updated.live, busId: updated._id });
  } catch (err) {
    console.error('POST /driver/ride/location error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get students assigned to this driver's bus (flatten route stops)
router.get('/attendance/students', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found' });
    // support optional query param busId to select which assigned bus to use
    const { busId } = req.query;
    let bus = null;
    if (busId) {
      if (!/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      bus = await Bus.findOne({ _id: busId, driver: driver._id }).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber class' } });
      if (!bus) return res.status(404).json({ message: 'No such bus assigned to driver' });
    } else {
      // if multiple buses, require explicit busId
      const buses = await Bus.find({ driver: driver._id }).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber class' } });
      if (!buses.length) return res.status(404).json({ message: 'No route or students assigned to this driver' });
      if (buses.length === 1) bus = buses[0];
      else return res.status(400).json({ message: 'Multiple buses assigned. Supply busId query parameter.' });
    }

    const students = [];
    for (const stop of (bus.route.stops || [])) {
      for (const s of (stop.students || [])) {
        if (!students.find(x => String(x._id) === String(s._id))) students.push(s);
      }
    }
    res.json({ busId: bus._id, students });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Driver marks bus attendance for a date (and session)
router.post('/attendance', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found' });
    const { busId, date: dateIn, records, session = 'morning' } = req.body;

    // require busId when driver has multiple buses
    let bus = null;
    if (busId) {
      if (!/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      bus = await Bus.findOne({ _id: busId, driver: driver._id });
      if (!bus) return res.status(404).json({ message: 'No such bus assigned to this driver' });
    } else {
      const buses = await Bus.find({ driver: driver._id });
      if (!buses.length) return res.status(404).json({ message: 'No bus assigned to this driver' });
      if (buses.length === 1) bus = buses[0];
      else return res.status(400).json({ message: 'Multiple buses assigned. Supply busId in request body.' });
    }

    const dateIso = dateIn ? new Date(dateIn).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const date = new Date(dateIso + 'T00:00:00Z');

    // upsert BusAttendance
    let ba = await BusAttendance.findOne({ busId: bus._id, date, session });
    if (ba) {
      ba.records = records;
    } else {
      ba = new BusAttendance({ busId: bus._id, date, session, records });
    }
    await ba.save();

    // also create StudentAttendance events for each record (helpful for logs)
    for (const r of (records || [])) {
      try {
        const sae = new StudentAttendance({ studentId: r.studentId, classId: null, scannerId: req.user._id, scannerRole: 'driver', type: 'bus', timestamp: new Date(), rawPayload: { busId: bus._id, date: date.toISOString(), session, status: r.status } });
        await sae.save();
      } catch (e) { console.warn('failed writing studentAttendance event', e.message) }
    }

    return res.json({ message: 'Bus attendance saved', busAttendanceId: ba._id, busId: bus._id });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error', error: err.message }); }
});

// Driver: get bus attendance records for a specific date/session (to pre-fill form)
router.get('/attendance', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found' });
    const { busId, date: dateIn, session = 'morning' } = req.query;
    if (!dateIn) return res.status(400).json({ message: 'Date required' });

    let bus = null;
    if (busId) {
      if (!/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      bus = await Bus.findOne({ _id: busId, driver: driver._id });
      if (!bus) return res.status(404).json({ message: 'No such bus assigned to this driver' });
    } else {
      const buses = await Bus.find({ driver: driver._id });
      if (!buses.length) return res.status(404).json({ message: 'No bus assigned' });
      if (buses.length === 1) bus = buses[0];
      else return res.status(400).json({ message: 'Multiple buses assigned. Supply busId query parameter.' });
    }

    const dateIso = new Date(dateIn).toISOString().split('T')[0];
    const date = new Date(dateIso + 'T00:00:00Z');

    const ba = await BusAttendance.findOne({ busId: bus._id, date, session });
    res.json(ba ? { records: ba.records } : { records: [] });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Driver: get bus attendance report (startDate,endDate optional)
router.get('/attendance/report', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user.id });
    if (!driver) return res.status(403).json({ message: 'Driver profile not found' });
    const { busId, startDate, endDate, session } = req.query;

    let bus = null;
    if (busId) {
      if (!/^[0-9a-fA-F]{24}$/.test(busId)) return res.status(400).json({ message: 'Invalid busId' });
      bus = await Bus.findOne({ _id: busId, driver: driver._id }).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber' } });
      if (!bus) return res.status(404).json({ message: 'No such bus assigned to driver' });
    } else {
      const buses = await Bus.find({ driver: driver._id }).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber' } });
      if (!buses.length) return res.status(404).json({ message: 'No bus assigned' });
      if (buses.length === 1) bus = buses[0];
      else return res.status(400).json({ message: 'Multiple buses assigned. Supply busId query parameter.' });
    }

    const query = { busId: bus._id };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (session) query.session = session;

    const records = await BusAttendance.find(query).sort({ date: -1 });

    // build report per student from route students
    const students = [];
    for (const stop of (bus.route.stops || [])) for (const s of (stop.students || [])) if (!students.find(x => String(x._id) === String(s._id))) students.push(s);

    const report = students.map(student => {
      const totalDays = records.length;
      const presentDays = records.reduce((acc, rec) => {
        const r = (rec.records || []).find(rr => String(rr.studentId) === String(student._id));
        return acc + (r && r.status === 'present' ? 1 : 0);
      }, 0);
      return { student: { _id: student._id, name: `${student.firstName || ''} ${student.lastName || ''}`.trim(), rollNo: student.rollNumber || '' }, totalDays, presentDays, percentage: totalDays ? (presentDays / totalDays) * 100 : 0 };
    });

    res.json({ bus: { _id: bus._id, number: bus.number }, report, records });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;


