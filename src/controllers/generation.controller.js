const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { STAGES, STATUSES, initSSE, sendEvent } = require('../ai/sse');

exports.health = asyncHandler(async (_req, res) => {
  res.json({ status: 'ok', domain: 'generation' });
});

// Throwaway Phase 0 endpoint proving the SSE transport and frozen event schema
// round-trip; replaced by the real generate stream in Phase 3.
exports.streamTest = asyncHandler(async (_req, res) => {
  initSSE(res);
  STATUSES.forEach((status, i) => {
    sendEvent(res, {
      runId: 'phase0-test',
      stage: STAGES[i % STAGES.length],
      status,
      payload: { seq: i },
    });
  });
  res.end();
});

exports.createRun = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.getRun = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});

exports.listRuns = asyncHandler(async () => {
  throw new ApiError(501, 'Not implemented');
});
