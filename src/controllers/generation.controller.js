const Chat = require('../models/Chat');
const Message = require('../models/Message');
const PipelineRun = require('../models/PipelineRun');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { initSSE, sendEvent } = require('../ai/sse');
const { runPipeline, buildFixMessage, MAX_FIX_ROUNDS } = require('../ai/orchestrator');
const { normalizeImage } = require('../services/assets');

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
  if (result.qaVerdict) {
    stages.qa = { verdict: result.qaVerdict, findings: result.qaFindings || [] };
  } else if (previous && previous.qa) {
    stages.qa = previous.qa;
  }
  return stages;
}

exports.health = asyncHandler(async (_req, res) => {
  res.json({ status: 'ok', domain: 'generation' });
});

exports.generate = asyncHandler(async (req, res) => {
  const { chatId } = req.body || {};
  const prompt = String((req.body && req.body.prompt) || '').trim();
  const image = normalizeImage(req.body && req.body.image);
  // With a screenshot the prompt is optional (rebuild what's shown).
  if (!prompt && !image) throw new ApiError(400, 'prompt or image is required');
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw new ApiError(400, `prompt must be ${PROMPT_MAX_LENGTH} characters or fewer`);
  }
  const effectivePrompt = prompt || 'Rebuild the attached screenshot as Chumlab components.';

  let chat;
  if (chatId) {
    chat = await Chat.findById(chatId);
    if (!chat || !chat.userId.equals(req.user._id)) throw new ApiError(404, 'Chat not found');
  } else {
    chat = await Chat.create({ userId: req.user._id, title: (prompt || 'Screenshot rebuild').slice(0, 120) });
  }

  const history = (
    await Message.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT)
  ).reverse();

  const run = await PipelineRun.create({
    userId: req.user._id,
    chatId: chat._id,
    status: 'running',
  });
  await Message.create({ chatId: chat._id, role: 'user', content: effectivePrompt, image });

  initSSE(res);
  const runId = String(run._id);
  try {
    const result = await runPipeline({
      runId,
      chatId: String(chat._id),
      res,
      image,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: effectivePrompt },
      ],
    });

    // Clarify paused the run - persist the questions and wait for /resume.
    // No assistant message yet; the user prompt is already saved.
    if (result.status === 'needs_input') {
      run.status = 'needs_input';
      run.clarify = {
        questions: result.questions,
        assumptions: result.assumptions,
        tier: result.tier,
        prompt,
      };
      run.stages = buildStages(result);
      await run.save();
      res.end();
      return;
    }

    await Message.create({ chatId: chat._id, role: 'assistant', content: result.text });
    await Chat.updateOne({ _id: chat._id }, { $currentDate: { updatedAt: true } });
    run.status = 'done';
    run.fixRounds = result.roundsUsed;
    run.verifyStatus = result.verifyStatus;
    run.qaVerdict = result.qaVerdict;
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
    run.qaVerdict = result.qaVerdict;
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

// Resumes a run paused on clarify. Answers (or a skip) come back here, are
// persisted + injected into the build context, and the run continues Plan ->
// Develop onward over a fresh SSE response - same transport as /generate/fix.
exports.resumeRun = asyncHandler(async (req, res) => {
  const { runId } = req.body || {};
  const answers = Array.isArray(req.body && req.body.answers) ? req.body.answers : [];

  const run = await PipelineRun.findById(runId);
  if (!run || !run.userId.equals(req.user._id)) throw new ApiError(404, 'Run not found');
  if (run.status !== 'needs_input' || !run.clarify) {
    throw new ApiError(400, 'Run is not awaiting input');
  }

  const clarify = run.clarify;
  const questions = clarify.questions || [];
  const answered = questions
    .map((q, i) => (answers[i] ? `${q.question} ${answers[i]}` : null))
    .filter(Boolean);

  let displayText;
  let modelPrompt;
  if (answered.length) {
    displayText = `Clarifications — ${answered.join(' · ')}`;
    modelPrompt = `${clarify.prompt}\n\nClarifications:\n${answered.map((a) => `- ${a}`).join('\n')}`;
  } else {
    displayText = 'Skipped clarifications — building with sensible defaults.';
    modelPrompt = `${clarify.prompt}\n\nProceed with sensible defaults${clarify.assumptions ? `: ${clarify.assumptions}` : ''}.`;
  }

  const history = (
    await Message.find({ chatId: run.chatId }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT)
  ).reverse();
  // The paused user prompt is the last stored turn - replace it with the
  // clarified build message so the model gets one coherent request. Carry its
  // screenshot forward so a paused vision build still sees the image on resume.
  const pausedImage = history.length ? history[history.length - 1].image : null;
  const priorHistory = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  await Message.create({ chatId: run.chatId, role: 'user', content: displayText });

  run.status = 'running';
  run.clarify = { ...clarify, answers };
  await run.save();

  initSSE(res);
  try {
    const result = await runPipeline({
      runId: String(run._id),
      chatId: String(run.chatId),
      res,
      resumed: true,
      tier: clarify.tier,
      assumptions: clarify.assumptions,
      image: pausedImage,
      messages: [...priorHistory, { role: 'user', content: modelPrompt }],
    });

    await Message.create({ chatId: run.chatId, role: 'assistant', content: result.text });
    await Chat.updateOne({ _id: run.chatId }, { $currentDate: { updatedAt: true } });
    run.status = 'done';
    run.fixRounds = result.roundsUsed;
    run.verifyStatus = result.verifyStatus;
    run.qaVerdict = result.qaVerdict;
    run.stages = buildStages(result, run.stages);
    await run.save();

    const onboarding = req.playgroundOnboarding;
    if (onboarding && onboarding.status === 'invited') {
      onboarding.status = 'onboarded';
      onboarding.onboardedAt = new Date();
      await onboarding.save();
    }

    res.end();
  } catch (err) {
    run.status = 'error';
    await run.save().catch(() => {});
    sendEvent(res, {
      runId: String(run._id),
      stage: 'develop',
      status: 'error',
      payload: { message: err.message || 'Generation failed' },
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
