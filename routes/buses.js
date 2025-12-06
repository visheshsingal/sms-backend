const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Driver = require('../models/Driver');
const Route = require('../models/Route');
const auth = require('../middleware/auth');
const BusAttendance = require('../models/BusAttendance');
const StudentAttendance = require('../models/StudentAttendance');

// List buses
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
  try {
    const buses = await Bus.find().sort({ createdAt: -1 })
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    res.json(buses);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create bus (admin or bus-incharge)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { driver, ...busDataIn } = req.body;
    const busData = { ...busDataIn }
    // sanitize create payload: remove empty strings / nulls and coerce numbers
    Object.keys(busData).forEach((k) => {
      if (busData[k] === '' || busData[k] === null) delete busData[k]
    })
    if (busData.capacity !== undefined) busData.capacity = Number(busData.capacity)

    // NOTE: route assignment is handled from the Routes endpoints. Do not set route here.

    // resolve driver if provided (accept id/license/phone)
    if (driver) {
      let drv = null;
      if (typeof driver === 'string') {
        if (/^[0-9a-fA-F]{24}$/.test(driver)) drv = await Driver.findById(driver);
        if (!drv) drv = await Driver.findOne({ licenseNumber: driver }) || await Driver.findOne({ phone: driver });
      } else if (typeof driver === 'object' && driver._id) {
        drv = await Driver.findById(driver._id);
      }
      if (drv) busData.driver = drv._id
    }

    // basic validation: number is required
    if (!busData.number) return res.status(400).json({ message: 'Bus number is required' });
    const b = new Bus({ ...busData });
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

// Bus Attendance: get records (admin or bus-incharge)
router.get('/:id/attendance', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
    const { id } = req.params;
    const { startDate, endDate, session } = req.query;
    const query = { busId: id };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (session) query.session = session;
    const recs = await BusAttendance.find(query).sort({ date: -1, session: 1 }).populate('records.studentId', 'firstName lastName rollNumber');
    res.json(recs);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Bus Attendance: update records (admin or bus-incharge)
router.post('/:id/attendance', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
    const { id } = req.params;
    const { date: dateIn, records, session } = req.body;

    // Default session to morning if not provided
    const sess = session || 'morning';
    if (!['morning', 'evening'].includes(sess)) return res.status(400).json({ message: 'Invalid session' });

    const dateIso = dateIn ? new Date(dateIn).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const date = new Date(dateIso + 'T00:00:00Z');

    let ba = await BusAttendance.findOne({ busId: id, date, session: sess });
    if (ba) { ba.records = records; } else { ba = new BusAttendance({ busId: id, date, session: sess, records }); }
    await ba.save();

    // write student attendance events (logs)
    for (const r of (records || [])) {
      try { const sae = new StudentAttendance({ studentId: r.studentId, classId: null, scannerId: req.user._id, scannerRole: req.user.role, type: 'bus', timestamp: new Date(), rawPayload: { busId: id, date: date.toISOString(), session: sess, status: r.status } }); await sae.save(); } catch (e) { console.warn('studentAttendance log error', e.message) }
    }

    res.json({ message: 'Saved', busAttendanceId: ba._id });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error', error: err.message }); }
});

// Bus Attendance: report (admin or bus-incharge)
router.get('/:id/attendance/report', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
    const { id } = req.params;
    const { startDate, endDate, session } = req.query;
    const query = { busId: id };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (session) query.session = session;

    const recs = await BusAttendance.find(query).sort({ date: -1 });
    // collect students from bus route
    const bus = await Bus.findById(id).populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName rollNumber' } });
    const students = [];
    if (bus && bus.route) { for (const stop of (bus.route.stops || [])) for (const s of (stop.students || [])) if (!students.find(x => String(x._id) === String(s._id))) students.push(s); }
    const report = students.map(student => {
      // Total potential sessions: unique dates * sessions per day? 
      // Simplified: total count of attendance records found (each record is a session)
      const totalSessions = recs.length;
      const presentSessions = recs.reduce((acc, rec) => { const r = (rec.records || []).find(rr => String(rr.studentId) === String(student._id)); return acc + (r && r.status === 'present' ? 1 : 0); }, 0);
      return { student: { _id: student._id, name: `${student.firstName || ''} ${student.lastName || ''}`.trim(), rollNo: student.rollNumber || '' }, totalSessions, presentSessions, percentage: totalSessions ? (presentSessions / totalSessions) * 100 : 0 };
    });
    res.json({ bus: { _id: bus._id, number: bus.number }, report, records: recs });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// Update bus
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
  try {
    const update = { ...req.body };
    // NOTE: route assignment is handled from the Routes endpoints. Do not update route here.

    // driver handling: allow unset (empty string -> null) or resolve id/license/phone
    if (Object.prototype.hasOwnProperty.call(update, 'driver')) {
      if (update.driver === '' || update.driver === null) {
        // explicit unassign
        update.driver = null
      } else {
        let drv = null;
        if (typeof update.driver === 'string') {
          if (/^[0-9a-fA-F]{24}$/.test(update.driver)) drv = await Driver.findById(update.driver);
          if (!drv) drv = await Driver.findOne({ licenseNumber: update.driver }) || await Driver.findOne({ phone: update.driver });
        } else if (typeof update.driver === 'object' && update.driver._id) {
          drv = await Driver.findById(update.driver._id);
        }
        update.driver = drv ? drv._id : undefined;
      }
    }

    // remove undefined keys so mongoose doesn't get e.g. { driver: undefined }
    Object.keys(update).forEach((k) => {
      if (update[k] === undefined) delete update[k]
      // also remove empty strings from other fields (route '') to avoid cast errors
      if (update[k] === '') delete update[k]
    })

    // coerce numeric fields
    if (update.capacity !== undefined) update.capacity = Number(update.capacity)

    const b = await Bus.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('driver', 'firstName lastName licenseNumber phone')
      .populate({ path: 'route', populate: { path: 'stops.students', select: 'firstName lastName' } });
    if (!b) return res.status(404).json({ message: 'Not found' });
    res.json(b);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete bus
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'bus-incharge') return res.status(403).json({ message: 'Forbidden' });
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ message: 'Not found' });
    await Bus.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
