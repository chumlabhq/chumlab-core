const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleSub: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    picture: { type: String, trim: true, maxlength: 500 },
    initials: { type: String, trim: true, maxlength: 4 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
