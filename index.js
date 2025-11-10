require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const MONGO = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/school-db';

mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Mongo connection error', err));

app.get('/', (req, res) => res.json({ message: 'School API running' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
// admin sub-routes for students, teachers, finance, reports
app.use('/api/admin/students', require('./routes/students'));
app.use('/api/admin/teachers', require('./routes/teachers'));
app.use('/api/admin/finance', require('./routes/finance'));
app.use('/api/admin/reports', require('./routes/reports'));
app.use('/api/admin/classes', require('./routes/classes'));
app.use('/api/admin/notices', require('./routes/notices'));
app.use('/api/admin/routes', require('./routes/routes'));

// new admin routes for drivers and buses
app.use('/api/admin/drivers', require('./routes/drivers'));
app.use('/api/admin/buses', require('./routes/buses'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/teacher', require('./routes/teacherPortal'));
app.use('/api/student', require('./routes/studentPortal'));
// driver portal for logged-in drivers
app.use('/api/driver', require('./routes/driverPortal'));
app.use('/api/leaves', require('./routes/leaves'));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
