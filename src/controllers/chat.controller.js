const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.listChats = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.createChat = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.getChat = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.deleteChat = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.listMessages = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});
