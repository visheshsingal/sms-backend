const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const Student = require('../models/Student');
const StudentAttendance = require('../models/StudentAttendance');
const Attendance = require('../models/Attendance');
const BusAttendance = require('../models/BusAttendance');

// Helper to encode payload into a QR-friendly string (base64 of JSON)
function encodePayload(payload){
	const json = JSON.stringify(payload);
	return Buffer.from(json).toString('base64');
}

function decodePayload(raw){
	// try plain JSON first
	try { return JSON.parse(raw); } catch(e){}
	// try base64 decode
	try {
		const json = Buffer.from(raw, 'base64').toString('utf8');
		return JSON.parse(json);
	} catch(e) {
		throw new Error('Unable to decode QR payload');
	}
}

// POST /api/qr/generate/:studentId  -- generate and save a QR token for a student (admin only)

// Allow admin or the student themself to generate a QR token
router.post('/generate/:studentId', auth, async (req, res) => {
	try {
		if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
		const { studentId } = req.params;
		const student = await Student.findById(studentId).populate('class');
		if (!student) return res.status(404).json({ message: 'Student not found' });

		// allow if admin, or if logged-in user is the student owner
		const isAdmin = req.user.role === 'admin';
		const isOwner = req.user.role === 'student' && student.userId && student.userId.toString() === req.user._id.toString();
		if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Forbidden' });

		// generate secure token
		const token = crypto.randomBytes(16).toString('hex');
		const issuedAt = new Date();
		// default expiration 365 days (can be adjusted)
		const expires = new Date(issuedAt.getTime() + 365*24*60*60*1000);

		student.qrToken = token;
		student.qrTokenIssuedAt = issuedAt;
		student.qrTokenExpires = expires;
		await student.save();

		const payload = {
			studentId: student._id.toString(),
			token,
			rollNumber: student.rollNumber || null,
			classId: student.class ? (student.class._id ? student.class._id.toString() : student.class) : null,
			className: student.class && student.class.name ? student.class.name : null
		};

		const raw = encodePayload(payload);

		return res.json({ raw, payload });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error', error: err.message });
	}
});

// POST /api/qr/generate-me -- allow a logged-in student to generate their own QR (requires Student.userId linkage)
router.post('/generate-me', auth, async (req, res) => {
	try {
		if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
		if (req.user.role !== 'student') return res.status(403).json({ message: 'Only students may generate their own QR' });

		const student = await Student.findOne({ userId: req.user._id }).populate('class');
		if (!student) return res.status(404).json({ message: 'Student record not found for this user. Contact admin to link your account.' });

		const token = crypto.randomBytes(16).toString('hex');
		const issuedAt = new Date();
		const expires = new Date(issuedAt.getTime() + 365*24*60*60*1000);

		student.qrToken = token;
		student.qrTokenIssuedAt = issuedAt;
		student.qrTokenExpires = expires;
		await student.save();

		const payload = {
			studentId: student._id.toString(),
			token,
			rollNumber: student.rollNumber || null,
			classId: student.class ? (student.class._id ? student.class._id.toString() : student.class) : null,
			className: student.class && student.class.name ? student.class.name : null
		};
		const raw = encodePayload(payload);
		return res.json({ raw, payload });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error', error: err.message });
	}
});

// POST /api/qr/generate-all  -- admin: generate tokens for all students and return raw payloads
router.post('/generate-all', auth, async (req, res) => {
	try {
		if (!req.user || req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
		const students = await Student.find().populate('class');
		const results = [];
		for (const student of students) {
			const token = crypto.randomBytes(16).toString('hex');
			const issuedAt = new Date();
			const expires = new Date(issuedAt.getTime() + 365*24*60*60*1000);
			student.qrToken = token;
			student.qrTokenIssuedAt = issuedAt;
			student.qrTokenExpires = expires;
			await student.save();

			const payload = {
				studentId: student._id.toString(),
				token,
				rollNumber: student.rollNumber || null,
				classId: student.class ? (student.class._id ? student.class._id.toString() : student.class) : null,
				className: student.class && student.class.name ? student.class.name : null
			};
			results.push({ studentId: student._id.toString(), raw: encodePayload(payload), payload });
		}
		return res.json({ count: results.length, results });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error', error: err.message });
	}
});

// POST /api/qr/scan  -- scanner posts raw scanned QR text; must be authenticated (driver/teacher)
router.post('/scan', auth, async (req, res) => {
	try {
		const { raw, type: requestedType } = req.body;
		if (!raw) return res.status(400).json({ message: 'Missing raw QR payload' });
		// only allow drivers or teachers to scan
		const scannerRole = req.user.role;
		if (!['driver', 'teacher'].includes(scannerRole)) return res.status(403).json({ message: 'Only drivers or teachers may scan QR codes' });

		let payload;
		try { payload = decodePayload(raw); } catch(e){ return res.status(400).json({ message: 'Invalid QR payload' }); }

		const { studentId, token } = payload;
		if (!studentId || !token) return res.status(400).json({ message: 'QR payload missing required fields' });

		const student = await Student.findById(studentId).populate('class');
		if (!student) return res.status(404).json({ message: 'Student not found' });

		// check token match and expiry
		if (!student.qrToken || student.qrToken !== token) return res.status(401).json({ message: 'Invalid or expired token' });
		if (student.qrTokenExpires && new Date() > student.qrTokenExpires) return res.status(401).json({ message: 'QR token expired' });

		// determine attendance type
		let type = requestedType;
		if (!type){
			if (scannerRole === 'driver') type = 'pickup';
			else if (scannerRole === 'teacher') type = 'daily';
			else type = 'other';
		}

		// always log the scan event
		const attendanceEvent = new StudentAttendance({
			studentId: student._id,
			classId: student.class ? student.class._id : null,
			scannerId: req.user._id,
			scannerRole,
			type,
			timestamp: new Date(),
			rawPayload: payload
		});
		await attendanceEvent.save();

		// If driver scanned, also mark bus attendance for this student's bus (present)
		let busAttendanceId = null;
		let previousBusStatus = null;
		if (scannerRole === 'driver'){
			try{
				// find driver and their bus
				const Driver = require('../models/Driver');
				const Bus = require('../models/Bus');
				const driver = await Driver.findOne({ userId: req.user.id });
				if (driver){
					const bus = await Bus.findOne({ driver: driver._id });
					if (bus){
						// normalize date like driver endpoints: use local date -> UTC midnight
						const now = new Date();
						const isoDay = now.toISOString().split('T')[0];
						const date = new Date(isoDay + 'T00:00:00Z');
						let ba = await BusAttendance.findOne({ busId: bus._id, date });
						if (!ba) ba = new BusAttendance({ busId: bus._id, date, records: [] });
						const sidStr = student._id.toString();
						const idx = (ba.records||[]).findIndex(r => String(r.studentId) === sidStr);
						if (idx >= 0){
							previousBusStatus = ba.records[idx].status || null;
							ba.records[idx].status = 'present';
						} else {
							previousBusStatus = null;
							ba.records.push({ studentId: student._id, status: 'present' });
						}
						await ba.save();
						busAttendanceId = ba._id;
					}
				}
			}catch(e){ console.warn('Failed to mark bus attendance from QR scan', e.message) }
		}

		// If teacher scanned, mark daily attendance in Attendance collection
		let attendanceRecordId = null;
		let attendanceDate = null;
		let previousAttendanceStatus = null;
		if (scannerRole === 'teacher'){
			const classId = student.class ? (student.class._id ? student.class._id : student.class) : null;
			if (!classId) return res.status(400).json({ message: 'Student not assigned to a class' });

			// normalize date to UTC start of day (use YYYY-MM-DDT00:00:00Z)
			const now = new Date();
			const isoDay = now.toISOString().split('T')[0]; // YYYY-MM-DD in UTC
			const date = new Date(isoDay + 'T00:00:00Z');

			let att = await Attendance.findOne({ classId: classId, date });
			if (!att){
				att = new Attendance({ classId: classId, date, records: [] });
			}

			const sidStr = student._id.toString();
			const idx = att.records.findIndex(r => r.studentId && r.studentId.toString() === sidStr);
			if (idx >= 0){
				previousAttendanceStatus = att.records[idx].status || null;
				att.records[idx].status = 'present';
			} else {
				previousAttendanceStatus = null;
				att.records.push({ studentId: student._id, status: 'present' });
			}

			await att.save();
			attendanceRecordId = att._id;
			attendanceDate = att.date;
		}

		// return useful info to client for UI confirmation, including previous statuses
		return res.json({
			message: 'Attendance recorded',
			eventId: attendanceEvent._id,
			student: {
				_id: student._id,
				firstName: student.firstName,
				lastName: student.lastName,
				rollNumber: student.rollNumber || null,
				classId: student.class ? (student.class._id ? student.class._id : student.class) : null,
				className: student.class && student.class.name ? student.class.name : null
			},
			attendance: attendanceRecordId ? { attendanceId: attendanceRecordId, date: attendanceDate } : null,
			busAttendanceId: busAttendanceId || null,
			previousAttendanceStatus: previousAttendanceStatus || null,
			previousBusAttendanceStatus: previousBusStatus || null
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Server error', error: err.message });
	}
});

module.exports = router;

