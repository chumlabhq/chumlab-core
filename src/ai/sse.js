const STAGES = ['router', 'clarify', 'plan', 'develop', 'verify', 'qa', 'deliver'];
const STATUSES = ['start', 'delta', 'done', 'error', 'needs_input'];

function initSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Nginx buffers proxied responses by default, which would hold events back
  // until the buffer fills; this opts the stream out.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendEvent(res, event) {
  const { runId, stage, status, payload } = event || {};
  if (!runId || !STAGES.includes(stage) || !STATUSES.includes(status)) {
    throw new Error(`Malformed SSE event: ${JSON.stringify(event)}`);
  }
  res.write(`data: ${JSON.stringify({ runId, stage, status, payload })}\n\n`);
}

module.exports = { STAGES, STATUSES, initSSE, sendEvent };
