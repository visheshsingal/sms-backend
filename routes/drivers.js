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
  // Normalize role and provide clearer diagnostics when forbidden
  const callerRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
  if (callerRole !== 'admin') {
    console.warn('Forbidden driver create attempt', { userId: req.user ? req.user._id : null, role: callerRole });
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    let { username, password, ...driverData } = req.body;

    // Basic validation for driver fields
    if (!driverData.firstName || !driverData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });

    // If password provided but username missing, derive from email local-part
    if (password && !username && driverData.email) {
      username = (driverData.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
    }

    // If no credentials provided, create driver without linked User
    if (!username && !password) {
      const d = new Driver({ ...driverData });
      await d.save();
      return res.json(d);
    }

    // If either username or password present, both are required to create a login
    if (!username || !password) return res.status(400).json({ message: 'Both username and password are required to create a login for driver' });

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
    const user = new User({ username, passwordHash: hash, role: 'driver', email: driverData.email || `${username}@noemail.local` });
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
  const callerRoleUp = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
  if (callerRoleUp !== 'admin') {
    console.warn('Forbidden driver update attempt', { userId: req.user ? req.user._id : null, role: callerRoleUp });
    return res.status(403).json({ message: 'Forbidden' });
  }
  try {
    const { username, password, ...update } = req.body;
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Not found' });

    // Handle linked User account updates
    if (username || password) {
      let user = null;
      if (driver.userId) user = await User.findById(driver.userId);

      if (username) {
        const existing = await User.findOne({ username });
        if (existing && (!user || existing._id.toString() !== user._id.toString())) {
          return res.status(400).json({ message: 'Username already taken' });
        }
        if (user) {
          user.username = username;
        } else {
          if (!password) return res.status(400).json({ message: 'Password required when creating new user' });
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username, passwordHash: hash, role: 'driver', email: driver.email || `${username}@noemail.local` });
          await user.save();
          driver.userId = user._id;
        }
      } else if (password && !username && !user) {
        // derive username from email if not provided
        if (driver.email) {
          const derived = (driver.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
          const hash = await bcrypt.hash(password, 10);
          user = new User({ username: derived, passwordHash: hash, role: 'driver', email: driver.email });
          await user.save();
          driver.userId = user._id;
        } else {
          return res.status(400).json({ message: 'Email required to derive username when creating user without explicit username' });
        }
      }

      if (password && user) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }

      if (user) await user.save();
    }

    Object.assign(driver, update);
    await driver.save();
    res.json(driver);
  } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete driver
router.delete('/:id', auth, async (req, res) => {
  const callerRoleDel = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
  if (callerRoleDel !== 'admin') {
    console.warn('Forbidden driver delete attempt', { userId: req.user ? req.user._id : null, role: callerRoleDel });
    return res.status(403).json({ message: 'Forbidden' });
  }
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
