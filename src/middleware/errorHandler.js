const ApiError = require('../utils/ApiError');

function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  if (err && err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      details: Object.values(err.errors || {}).map((e) => e.message),
    });
  }

  if (err && err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate value',
      details: err.keyValue,
    });
  }

  console.error('[chumlab-be] unhandled error:', err);

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}

module.exports = errorHandler;
