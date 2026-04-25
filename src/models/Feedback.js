const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 0, max: 5, default: 0 },
    feedback: { type: String, trim: true, maxlength: 500, default: '' },
    amount: { type: Number, required: true, min: 5 },
    currency: { type: String, default: 'USD', uppercase: true, maxlength: 3 },
    selected: { type: Number, default: null },
    user: {
      name: { type: String, trim: true, maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    },
    source: { type: String, default: 'buy-me-coffee', maxlength: 60 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['new', 'in_review', 'resolved', 'archived'],
      default: 'new',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Feedback', feedbackSchema);
