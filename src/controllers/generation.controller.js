const Chat = require('../models/Chat');
const Message = require('../models/Message');
const PipelineRun = require('../models/PipelineRun');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { initSSE, sendEvent } = require('../ai/sse');
const { runPipeline } = require('../ai/orchestrator');

const PROMPT_MAX_LENGTH = 4000;
const HISTORY_LIMIT = 20;

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
    const generated = await runPipeline({
      runId,
      chatId: String(chat._id),
      res,
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt },
      ],
    });

    await Message.create({ chatId: chat._id, role: 'assistant', content: generated });
    await Chat.updateOne({ _id: chat._id }, { $currentDate: { updatedAt: true } });
    run.status = 'done';
    run.stages = { develop: { status: 'done' } };
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
