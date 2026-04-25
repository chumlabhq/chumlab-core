const validator = require('validator');
const Support = require('../models/Support');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.create = asyncHandler(async (req, res) => {
  const { name, email, subject, message, priority, metadata } = req.body || {};

  if (!name || !email || !subject || !message) {
    throw new ApiError(400, 'name, email, subject and message are required');
  }
  if (!validator.isEmail(String(email))) {
    throw new ApiError(400, 'email is invalid');
  }

  const doc = await Support.create({ name, email, subject, message, priority, metadata });
  res.status(201).json({ success: true, ticket: doc });
});

exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;

  const [items, total] = await Promise.all([
    Support.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Support.countDocuments(filter),
  ]);

  res.json({ success: true, total, page, limit, items });
});

exports.get = asyncHandler(async (req, res) => {
  const doc = await Support.findById(req.params.id);
  if (!doc) throw new ApiError(404, 'Ticket not found');
  res.json({ success: true, ticket: doc });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
  if (!allowed.includes(status)) {
    throw new ApiError(400, `status must be one of ${allowed.join(', ')}`);
  }
  const doc = await Support.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!doc) throw new ApiError(404, 'Ticket not found');
  res.json({ success: true, ticket: doc });
});
