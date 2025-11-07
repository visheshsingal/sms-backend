const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// List drivers
router.get('/', auth, async (req, res) => {
  try {
    const drivers = await Driver.find().sort({ createdAt: -1 });
    res.json(drivers);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create driver (admin only)
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const { username, password, ...driverData } = req.body;

    // Require credentials for driver accounts
    if (!username || !password) return res.status(400).json({ message: 'username and password required for driver account' });

    // Basic validation for driver fields
    if (!driverData.firstName || !driverData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });

    // Check if a User with this username already exists
    const exists = await User.findOne({ username });
    if (exists) {
      if (exists.role === 'driver') {
        // link existing driver account to new Driver
        const d = new Driver({ ...driverData, userId: exists._id });
        try {
          await d.save();
          return res.json(d);
        } catch (err) {
          console.error('Error saving driver with existing user:', err);
          return res.status(400).json({ message: 'Failed to create driver', error: err.message, details: err.errors || null });
        }
      }
      return res.status(400).json({ message: 'Username already taken' });
    }

    // Create the User first (mirrors teachers route). If user creation succeeds, create Driver and link.
    const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, passwordHash: hash, role: 'driver', email: `${username}@noemail.local` });
    try {
      await user.save();
    } catch (uerr) {
      console.error('Error creating user for driver:', uerr);
      // include more diagnostic info for debugging
      return res.status(500).json({ message: 'Failed to create associated user', error: uerr.message, name: uerr.name, code: uerr.code, keyValue: uerr.keyValue || null });
    }

    // Create and link Driver
    const d = new Driver({ ...driverData, userId: user._id });
    try {
      await d.save();
      res.json(d);
    } catch (err) {
      console.error('Error saving driver after creating user:', err);
      // cleanup created user
      await User.findByIdAndDelete(user._id).catch(()=>{});
      return res.status(400).json({ message: 'Failed to create driver', error: err.message, details: err.errors || null });
    }
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Get single driver
router.get('/:id', auth, async (req, res) => {
  try {
    const d = await Driver.findById(req.params.id);
    if (!d) return res.status(404).json({ message: 'Not found' });
    res.json(d);
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update driver
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const d = await Driver.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!d) return res.status(404).json({ message: 'Not found' });
    res.json(d);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete driver
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Not found' });
    if (driver.userId){
      await User.findByIdAndDelete(driver.userId);
    }
    await Driver.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
