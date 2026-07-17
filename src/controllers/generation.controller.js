const Chat = require('../models/Chat');
const Message = require('../models/Message');
const PipelineRun = require('../models/PipelineRun');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { initSSE, sendEvent } = require('../ai/sse');
const { runPipeline, buildFixMessage, MAX_FIX_ROUNDS } = require('../ai/orchestrator');

const PROMPT_MAX_LENGTH = 4000;
const HISTORY_LIMIT = 20;

function buildStages(result, previous) {
  const stages = {
    develop: { status: 'done', ...(result.truncationRetried ? { truncationRetried: true } : {}) },
  };
  // Fix continuations skip routing - carry the original run's router/plan.
  if (result.tier) stages.router = { tier: result.tier };
  else if (previous && previous.router) stages.router = previous.router;
  if (result.plan) stages.plan = { status: 'done', text: result.plan };
  else if (previous && previous.plan) stages.plan = previous.plan;
  if (result.verifyStatus) {
    stages.verify = {
      status: result.verifyStatus,
      attempts: [...((previous && previous.verify && previous.verify.attempts) || []), ...result.attempts],
    };
  }
  return stages;
}

exports.health = asyncHandler(async (_req, res) => {
  res.json({ status: 'ok', domain: 'generation' });
});

exports.generate = asyncHandler(async (req, res) => {
  const { chatId } = req.body || {};
  const prompt = String((req.body && req.body.prompt) || '').trim();
  if (!prompt) throw new ApiError(400, 'prompt is required');
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw new ApiError(400, `prompt must be ${PROMPT_MAX_LENGTH} characters or fewer`);
  }

  let chat;
  if (chatId) {
    chat = await Chat.findById(chatId);
    if (!chat || !chat.userId.equals(req.user._id)) throw new ApiError(404, 'Chat not found');
  } else {
    chat = await Chat.create({ userId: req.user._id, title: prompt.slice(0, 120) });
  }

  const history = (
    await Message.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT)
  ).reverse();

  const run = await PipelineRun.create({
    userId: req.user._id,
    chatId: chat._id,
    status: 'running',
  });
  await Message.create({ chatId: chat._id, role: 'user', content: prompt });

  initSSE(res);
  const runId = String(run._id);
  try {
    const result = await runPipeline({
      runId,
      chatId: String(chat._id),
      res,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt },
      ],
    });

    await Message.create({ chatId: chat._id, role: 'assistant', content: result.text });
    await Chat.updateOne({ _id: chat._id }, { $currentDate: { updatedAt: true } });
    run.status = 'done';
    run.fixRounds = result.roundsUsed;
    run.verifyStatus = result.verifyStatus;
    run.stages = buildStages(result);
    await run.save();

    // First successful generation moves the user off the waitlist.
    const onboarding = req.playgroundOnboarding;
    if (onboarding && onboarding.status === 'invited') {
      onboarding.status = 'onboarded';
      onboarding.onboardedAt = new Date();
      await onboarding.save();
    }

    res.end();
  } catch (err) {
    // Headers are already streaming - errors go down the SSE channel, not
    // the JSON error handler.
    run.status = 'error';
    run.stages = { develop: { status: 'error', message: err.message } };
    await run.save().catch(() => {});
    sendEvent(res, {
      runId,
      stage: 'develop',
      status: 'error',
      payload: { message: err.message || 'Generation failed' },
    });
    res.end();
  }
});

// Continuation for client-side render failures: the browser is the only
// place the third gate can run, so it reports the structured render error
// here and the fix streams back over a fresh SSE response. The failing code
// is the persisted assistant turn - never taken from the client.
exports.fixRun = asyncHandler(async (req, res) => {
  const { runId, error } = req.body || {};
  if (!error || error.kind !== 'render' || !error.message) {
    throw new ApiError(400, 'error must be a render VerifyError ({ kind: "render", message })');
  }

  const run = await PipelineRun.findById(runId);
  if (!run || !run.userId.equals(req.user._id)) throw new ApiError(404, 'Run not found');
  if (run.status !== 'done') throw new ApiError(400, 'Run is not in a fixable state');
  if (run.fixRounds >= MAX_FIX_ROUNDS) {
    throw new ApiError(400, 'Fix rounds exhausted for this run', { code: 'fix_rounds_exhausted' });
  }

  const failing = await Message.findOne({ chatId: run.chatId, role: 'assistant' }).sort({
    createdAt: -1,
  });
  if (!failing) throw new ApiError(400, 'No generated code to fix on this run');

  const history = (
    await Message.find({ chatId: run.chatId }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT)
  ).reverse();

  const renderError = {
    kind: 'render',
    message: String(error.message).slice(0, 2000),
    ...(error.loc ? { loc: String(error.loc).slice(0, 40) } : {}),
  };

  initSSE(res);
  try {
    const result = await runPipeline({
      runId: String(run._id),
      chatId: String(run.chatId),
      res,
      roundsUsed: run.fixRounds + 1,
      tier: (run.stages && run.stages.router && run.stages.router.tier) || null,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: buildFixMessage([renderError]) },
      ],
    });

    // The fix replaces the failing turn rather than appending a second one.
    failing.content = result.text;
    await failing.save();
    run.fixRounds = result.roundsUsed;
    run.verifyStatus = result.verifyStatus;
    run.stages = buildStages(result, run.stages);
    await run.save();

    res.end();
  } catch (err) {
    run.status = 'error';
    await run.save().catch(() => {});
    sendEvent(res, {
      runId: String(run._id),
      stage: 'develop',
      status: 'error',
      payload: { message: err.message || 'Fix failed' },
    });
    res.end();
  }
});

exports.getRun = asyncHandler(async (req, res) => {
  const run = await PipelineRun.findById(req.params.id);
  if (!run || !run.userId.equals(req.user._id)) throw new ApiError(404, 'Run not found');
  res.json({ success: true, run });
});

exports.listRuns = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const filter = { userId: req.user._id };
  if (req.query.chatId) filter.chatId = req.query.chatId;
  const runs = await PipelineRun.find(filter).sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, runs });
});
