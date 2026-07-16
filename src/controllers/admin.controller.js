const PlaygroundOnboarding = require('../models/PlaygroundOnboarding');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const STATUSES = PlaygroundOnboarding.STATUSES;

exports.updateOnboardingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of ${STATUSES.join(', ')}`);
  }

  const onboarding = await PlaygroundOnboarding.findById(req.params.id);
  if (!onboarding) {
    throw new ApiError(404, 'Onboarding not found');
  }

  onboarding.status = status;
  if (status === 'invited') onboarding.invitedAt = new Date();
  if (status === 'onboarded') onboarding.onboardedAt = new Date();
  await onboarding.save();

  res.json({ success: true, onboarding });
});
