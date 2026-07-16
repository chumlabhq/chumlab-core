const mongoose = require('mongoose');

const usageCounterSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dateKey: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

usageCounterSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model('UsageCounter', usageCounterSchema);
