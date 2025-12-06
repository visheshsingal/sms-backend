const express = require('express');
const router = express.Router();
const BusIncharge = require('../models/BusIncharge');
const auth = require('../middleware/auth');

// Get Bus Incharge profile by logged-in user
router.get('/me', auth, async (req, res) => {
    try {
        const busIncharge = await BusIncharge.findOne({ userId: req.user.id });
        if (!busIncharge) return res.status(404).json({ message: 'Bus Incharge profile not found' });
        res.json(busIncharge);
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
