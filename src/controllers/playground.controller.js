const PlaygroundOnboarding = require('../models/PlaygroundOnboarding');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const ROLES = PlaygroundOnboarding.ROLES;
const BUDGET_TIERS = PlaygroundOnboarding.BUDGET_TIERS;

function estimatedWaitFromPosition(position) {
  if (position <= 50) return 'Within 1 week';
  if (position <= 150) return '1-2 weeks';
  if (position <= 300) return '2-4 weeks';
  return '4-6 weeks';
}

exports.onboard = asyncHandler(async (req, res) => {
  const {
    role,
    context,
    contextLabel,
    budgetTier,
    budgetLabel,
    organization,
    phone,
    requirements,
    metadata,
  } = req.body || {};

  if (!ROLES.includes(role)) {
    throw new ApiError(400, `role must be one of ${ROLES.join(', ')}`);
  }
  if (!context || !contextLabel) {
    throw new ApiError(400, 'context and contextLabel are required');
  }
  if (!BUDGET_TIERS.includes(budgetTier)) {
    throw new ApiError(400, `budgetTier must be one of ${BUDGET_TIERS.join(', ')}`);
  }
  if (!budgetLabel) {
    throw new ApiError(400, 'budgetLabel is required');
  }
  if (requirements != null && String(requirements).length > 500) {
    throw new ApiError(400, 'requirements must be 500 characters or fewer');
  }

  const authedUser = req.user;
  const userBlock = {
    name: authedUser.name,
    email: authedUser.email,
    initials: authedUser.initials,
    picture: authedUser.picture,
  };

  const existing = await PlaygroundOnboarding.findOne({ googleSub: authedUser.googleSub });
  if (existing) {
    return res.status(200).json({
      success: true,
      alreadyOnboarded: true,
      submittedAt: existing.createdAt.toISOString(),
      position: existing.position,
      estimatedWait: estimatedWaitFromPosition(existing.position),
      submission: existing,
    });
  }

  const position = (await PlaygroundOnboarding.countDocuments({})) + 1;

  const doc = await PlaygroundOnboarding.create({
    googleSub: authedUser.googleSub,
    user: userBlock,
    role,
    context,
    contextLabel,
    budgetTier,
    budgetLabel,
    organization: organization || '',
    phone: phone || '',
    requirements: requirements || '',
    position,
    metadata: metadata || {},
  });

  res.status(201).json({
    success: true,
    alreadyOnboarded: false,
    submittedAt: doc.createdAt.toISOString(),
    position: doc.position,
    estimatedWait: estimatedWaitFromPosition(doc.position),
    submission: doc,
  });
});

exports.getMine = asyncHandler(async (req, res) => {
  const doc = await PlaygroundOnboarding.findOne({ googleSub: req.user.googleSub });
  if (!doc) {
    return res.json({ success: true, onboarding: null });
  }
  res.json({
    success: true,
    onboarding: doc,
    submittedAt: doc.createdAt.toISOString(),
    position: doc.position,
    estimatedWait: estimatedWaitFromPosition(doc.position),
  });
});

exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.role) filter.role = req.query.role;

  const [items, total] = await Promise.all([
    PlaygroundOnboarding.find(filter)
      .sort({ position: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PlaygroundOnboarding.countDocuments(filter),
  ]);

  res.json({ success: true, total, page, limit, items });
});

exports.count = asyncHandler(async (_req, res) => {
  const total = await PlaygroundOnboarding.countDocuments({});
  res.json({ success: true, total });
});
