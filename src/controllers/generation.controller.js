const Chat = require('../models/Chat');
const Message = require('../models/Message');
const PipelineRun = require('../models/PipelineRun');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { initSSE, sendEvent } = require('../ai/sse');
const {
  runPipeline,
  buildFixMessage,
  MAX_FIX_ROUNDS,
  BUILD_ANYWAY,
  BUILD_MAIN_ANYWAY,
} = require('../ai/orchestrator');

// Prepended to the assistant turn when the user overrides a page redirect with
// "build the main section anyway" — a soft guide, not a gate.
const PAGE_SCOPE_CAVEAT = 'Building the main section — it may not capture the full page.';
const { normalizeImage } = require('../services/assets');
const { classifyFollowup } = require('../ai/classifyFollowup');
const { chargeGeneration } = require('../middleware/quota');

const PROMPT_MAX_LENGTH = 4000;
const HISTORY_LIMIT = 20;

// The refine path's current component: the most recent assistant turn carrying a
// ```tsx fence (the same convention the orchestrator uses to detect prior code).
// Returns the fenced code, or null when the chat has no component to refine yet.
function latestCodeFrom(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    const start = m.content.indexOf('```tsx');
    if (start === -1) continue;
    const body = m.content.slice(start + 6).replace(/^\n/, '');
    const end = body.indexOf('```');
    return end === -1 ? body.trim() : body.slice(0, end).trim();
  }
  return null;
}

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

// Phase 10 · fold the pipeline's deliver metadata + timeline onto the run so
// the runs/chat projection and re-open path read them without recomputing.
// Code + prompt stay on Message; only this summary lands here.
function applyRunSummary(run, result) {
  if (result.timeline) run.timeline = result.timeline;
  const meta = result.deliverMeta;
  if (meta) {
    run.deliver = meta;
    run.componentType = meta.componentType;
    run.sizeKb = meta.sizeKb;
    run.a11y = meta.a11y;
    run.gatesPassed = meta.gatesPassed;
    run.title = meta.title;
  }
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

  // Refine-path intent guard (additive, fail-safe). Runs only when the chat
  // already has a component: a confident no-op or question is answered in-chat
  // with no rebuild. Any error, timeout, or ambiguity resolves to 'edit' and the
  // pipeline below runs exactly as today. Fresh builds have no prior code and
  // skip this entirely, so their latency is unchanged.
  const priorCode = latestCodeFrom(history);
  if (priorCode) {
    const { intent, message } = await classifyFollowup(priorCode, effectivePrompt);
    if ((intent === 'noop' || intent === 'question') && message) {
      initSSE(res);
      sendEvent(res, {
        runId: String(run._id),
        stage: 'router',
        status: 'done',
        payload: { outcome: 'answer', message },
      });
      await Message.create({ chatId: chat._id, role: 'assistant', content: message });
      await Chat.updateOne({ _id: chat._id }, { $currentDate: { updatedAt: true } });
      run.status = 'done';
      await run.save();
      res.end();
      return;
    }
  }

  // Commit to a build: atomically charge the per-user + global daily caps. A
  // no-op/question answer already returned above (free); a refine that reaches
  // here is a real build and counts. Over either cap → 429 before any build
  // starts. The user's turn stays in the thread (the client shows a "limit
  // reached" notice beside it); only the empty run is unwound.
  try {
    await chargeGeneration(req.user._id);
  } catch (err) {
    await run.deleteOne().catch(() => {});
    throw err;
  }

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

    // Declined (Track B) - the Router refused a harmful request. Persist the
    // refusal as an assistant turn; no build, no resume, no escape.
    if (result.status === 'declined') {
      await Message.create({ chatId: chat._id, role: 'assistant', content: result.message });
      await Chat.updateOne({ _id: chat._id }, { $currentDate: { updatedAt: true } });
      run.status = 'done';
      run.stages = buildStages(result);
      await run.save();
      res.end();
      return;
    }

    // Clarify paused the run - persist the questions and wait for /resume.
    // No assistant message yet; the user prompt is already saved.
    if (result.status === 'needs_input') {
      run.status = 'needs_input';
      run.clarify = {
        questions: result.questions,
        assumptions: result.assumptions,
        tier: result.tier,
        prompt,
        ...(result.reason ? { reason: result.reason } : {}),
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
    applyRunSummary(run, result);
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
    applyRunSummary(run, result);
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

  const history = (
    await Message.find({ chatId: run.chatId }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT)
  ).reverse();
  // The paused user prompt is the last stored turn - replace it with the
  // clarified build message so the model gets one coherent request. Carry its
  // screenshot forward so a paused vision build still sees the image on resume.
  const pausedImage = history.length ? history[history.length - 1].image : null;
  const priorHistory = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

  const isPageReason = clarify.reason === 'page' || clarify.reason === 'page_scope';
  let displayText;
  let modelPrompt;
  let sectionCaveat = false;
  if (clarify.reason) {
    // Router-driven clarify/redirect: the user picked one buildable unit, or the
    // "build anyway" escape. A pick BECOMES the build (it replaces the prompt);
    // the escape builds the best single-component interpretation.
    const pick = String(answers[0] || '').trim();
    const isEscape = !pick || pick === BUILD_ANYWAY || pick === BUILD_MAIN_ANYWAY;
    if (isEscape && isPageReason) {
      sectionCaveat = true;
      displayText = BUILD_MAIN_ANYWAY;
      modelPrompt = `${clarify.prompt}\n\nBuild ONLY the single most prominent section of this as one fully responsive component — not the whole page.`;
    } else if (isEscape) {
      displayText = BUILD_ANYWAY;
      modelPrompt = `${clarify.prompt}\n\nBuild your best single-component interpretation of this — pick sensible defaults.`;
    } else {
      displayText = pick;
      modelPrompt = `Build this as a single, fully responsive component${
        pausedImage ? ', matching the corresponding region of the attached screenshot' : ''
      }: ${pick}`;
    }
  } else {
    // Legacy clarify-stage resume (no reason): augment the original prompt.
    const answered = questions
      .map((q, i) => (answers[i] ? `${q.question} ${answers[i]}` : null))
      .filter(Boolean);
    if (answered.length) {
      displayText = `Clarifications — ${answered.join(' · ')}`;
      modelPrompt = `${clarify.prompt}\n\nClarifications:\n${answered.map((a) => `- ${a}`).join('\n')}`;
    } else {
      displayText = 'Skipped clarifications — building with sensible defaults.';
      modelPrompt = `${clarify.prompt}\n\nProceed with sensible defaults${clarify.assumptions ? `: ${clarify.assumptions}` : ''}.`;
    }
  }

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

    const assistantText = sectionCaveat ? `${PAGE_SCOPE_CAVEAT}\n\n${result.text}` : result.text;
    await Message.create({ chatId: run.chatId, role: 'assistant', content: assistantText });
    await Chat.updateOne({ _id: run.chatId }, { $currentDate: { updatedAt: true } });
    run.status = 'done';
    run.fixRounds = result.roundsUsed;
    run.verifyStatus = result.verifyStatus;
    run.qaVerdict = result.qaVerdict;
    run.stages = buildStages(result, run.stages);
    applyRunSummary(run, result);
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
