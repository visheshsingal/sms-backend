const express = require('express');
const router = express.Router();
const BusIncharge = require('../models/BusIncharge');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

// List bus incharges
router.get('/', auth, async (req, res) => {
    try {
        const busIncharges = await BusIncharge.find().sort({ createdAt: -1 });
        res.json(busIncharges);
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Create bus incharge (admin only)
router.post('/', auth, async (req, res) => {
    const callerRole = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (callerRole !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        // username is NOT accepted from client for bus incharge (auto-generated or derived)
        // password IS required
        let { password, ...inchargeData } = req.body;

        if (!inchargeData.firstName || !inchargeData.lastName) return res.status(400).json({ message: 'firstName and lastName are required' });
        if (!password) return res.status(400).json({ message: 'Password is required' });

        // derive username from email local-part or generate random if email missing (though email usually needed)
        let username = '';
        if (inchargeData.email) {
            username = (inchargeData.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
        }
        // ensure unique username suffix if needed, or fallback if no email
        if (!username || username.length < 3) {
            username = `incharge${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 100)}`;
        }

        // Check if a User with this username already exists (unlikely if random, possible if email-based)
        // If we want to be safe, we can append random digits if collision
        const exists = await User.findOne({ username });
        if (exists) {
            username = `${username}_${Math.floor(Math.random() * 1000)}`;
        }

        const hash = await bcrypt.hash(password, 10);
        const user = new User({
            username,
            passwordHash: hash,
            role: 'bus-incharge',
            email: inchargeData.email || `${username}@noemail.local`
        });

        try {
            await user.save();
        } catch (uerr) {
            return res.status(500).json({ message: 'Failed to create user account', error: uerr.message });
        }

        const b = new BusIncharge({ ...inchargeData, userId: user._id });
        try {
            await b.save();
            res.json(b);
        } catch (err) {
            await User.findByIdAndDelete(user._id).catch(() => { });
            return res.status(400).json({ message: 'Failed to create bus incharge', error: err.message });
        }
    } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Get single bus incharge
router.get('/:id', auth, async (req, res) => {
    try {
        const b = await BusIncharge.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Not found' });
        res.json(b);
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// Update bus incharge
router.put('/:id', auth, async (req, res) => {
    const callerRoleUp = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (callerRoleUp !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const { username, password, ...update } = req.body;
        const incharge = await BusIncharge.findById(req.params.id);
        if (!incharge) return res.status(404).json({ message: 'Not found' });

        if (username || password) {
            let user = null;
            if (incharge.userId) user = await User.findById(incharge.userId);

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
                    user = new User({ username, passwordHash: hash, role: 'bus-incharge', email: incharge.email || `${username}@noemail.local` });
                    await user.save();
                    incharge.userId = user._id;
                }
            } else if (password && !username && !user) {
                if (incharge.email) {
                    const derived = (incharge.email.split('@')[0] || '').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
                    const hash = await bcrypt.hash(password, 10);
                    user = new User({ username: derived, passwordHash: hash, role: 'bus-incharge', email: incharge.email });
                    await user.save();
                    incharge.userId = user._id;
                } else {
                    return res.status(400).json({ message: 'Email required to derive username' });
                }
            }

            if (password && user) {
                user.passwordHash = await bcrypt.hash(password, 10);
            }

            if (user) await user.save();
        }

        Object.assign(incharge, update);
        await incharge.save();
        res.json(incharge);
    } catch (err) { res.status(400).json({ message: 'Bad request', error: err.message }); }
});

// Delete bus incharge
router.delete('/:id', auth, async (req, res) => {
    const callerRoleDel = req.user && req.user.role ? String(req.user.role).toLowerCase() : null;
    if (callerRoleDel !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }
    try {
        const incharge = await BusIncharge.findById(req.params.id);
        if (!incharge) return res.status(404).json({ message: 'Not found' });
        if (incharge.userId) {
            await User.findByIdAndDelete(incharge.userId);
        }
        await BusIncharge.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
