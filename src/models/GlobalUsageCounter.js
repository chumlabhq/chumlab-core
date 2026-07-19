const mongoose = require('mongoose');

// One row per UTC day holding the all-users generation count — the backstop that
// caps total Anthropic spend even under many concurrent users. Incremented
// atomically at charge time alongside the per-user counter.
const globalUsageCounterSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GlobalUsageCounter', globalUsageCounterSchema);
