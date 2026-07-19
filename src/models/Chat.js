const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chat', chatSchema);
