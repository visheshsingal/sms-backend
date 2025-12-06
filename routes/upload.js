const express = require('express');
const router = express.Router();
const cloudinary = require('../utils/cloudinary');
const multer = require('multer');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' }); // Temp local folder

router.post('/', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'school_app',
        });

        // Clean up local file
        fs.unlinkSync(req.file.path);

        res.json({ url: result.secure_url, public_id: result.public_id });
    } catch (err) {
        console.error('Upload error:', err);
        // Try to cleanup if file exists
        if (req.file && req.file.path) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        res.status(500).json({ message: 'Upload failed', error: err.message });
    }
});

module.exports = router;
