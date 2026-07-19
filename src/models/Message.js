const mongoose = require('mongoose');

const ROLES = ['user', 'assistant'];

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    content: { type: String, required: true },
    // Optional attached screenshot on a vision turn: { mediaType, data(base64) }.
    // Persisted so the thumbnail survives reload and clarify-resume can re-attach it.
    image: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const Message = mongoose.model('Message', messageSchema);

Message.ROLES = ROLES;

module.exports = Message;
