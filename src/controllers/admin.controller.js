const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.listOnboardings = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.updateOnboardingStatus = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});
