const validator = require('validator');
const Feedback = require('../models/Feedback');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const MIN_AMOUNT_USD = 5;

exports.create = asyncHandler(async (req, res) => {
  const {
    rating,
    feedback,
    amount,
    currency = 'USD',
    selected,
    user = {},
    source,
    metadata,
  } = req.body || {};

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum < MIN_AMOUNT_USD) {
    throw new ApiError(400, `amount must be a number >= ${MIN_AMOUNT_USD} (USD)`);
  }

  if (rating != null) {
    const r = Number(rating);
    if (!Number.isFinite(r) || r < 0 || r > 5) {
      throw new ApiError(400, 'rating must be a number between 0 and 5');
    }
  }

  if (feedback != null && String(feedback).length > 500) {
    throw new ApiError(400, 'feedback must be 500 characters or fewer');
  }

  if (user.email && !validator.isEmail(String(user.email))) {
    throw new ApiError(400, 'user.email is invalid');
  }

  const doc = await Feedback.create({
    rating: rating != null ? Number(rating) : 0,
    feedback: feedback ? String(feedback).trim() : '',
    amount: amountNum,
    currency,
    selected: selected != null ? Number(selected) : null,
    user: {
      name: user.name,
      email: user.email,
    },
    source,
    metadata,
  });

  res.status(201).json({ success: true, feedback: doc });
});

exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Feedback.countDocuments(filter),
  ]);

  res.json({ success: true, total, page, limit, items });
});

exports.get = asyncHandler(async (req, res) => {
  const doc = await Feedback.findById(req.params.id);
  if (!doc) throw new ApiError(404, 'Feedback not found');
  res.json({ success: true, feedback: doc });
});
