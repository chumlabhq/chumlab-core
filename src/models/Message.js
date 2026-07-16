const mongoose = require('mongoose');

const ROLES = ['user', 'assistant'];

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

const Message = mongoose.model('Message', messageSchema);

Message.ROLES = ROLES;

module.exports = Message;
