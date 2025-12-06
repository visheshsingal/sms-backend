const mongoose = require('mongoose');

const NoticeReadSchema = new mongoose.Schema({
  noticeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notice', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  readAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('NoticeRead', NoticeReadSchema);
