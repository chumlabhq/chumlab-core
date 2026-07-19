const rateLimit = require('express-rate-limit');
const UsageCounter = require('../models/UsageCounter');
const GlobalUsageCounter = require('../models/GlobalUsageCounter');
const ApiError = require('../utils/ApiError');

// All three limits are env-configurable and reversible (set the env var; a very
// high value effectively disables a limit).
const DEFAULT_DAILY_LIMIT = 20; // per user, per UTC day
const DEFAULT_GLOBAL_DAILY_LIMIT = 150; // all users, per UTC day
const DEFAULT_BURST_PER_MINUTE = 10; // per user, sliding minute

const perUserDailyLimit = () =>
  parseInt(process.env.PLAYGROUND_DAILY_LIMIT, 10) || DEFAULT_DAILY_LIMIT;
const globalDailyLimit = () =>
  parseInt(process.env.PLAYGROUND_GLOBAL_DAILY_LIMIT, 10) || DEFAULT_GLOBAL_DAILY_LIMIT;
const burstPerMinute = () =>
  parseInt(process.env.PLAYGROUND_BURST_PER_MINUTE, 10) || DEFAULT_BURST_PER_MINUTE;

function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}

// `scope` lets the client word the notice precisely: a per-user daily cap, the
// all-users capacity cap, or a short-term burst throttle. The code stays
// `over_quota` so the existing gate detection is unchanged.
function overQuota(scope, limit, used, resetsAt) {
  const message =
    scope === 'global'
      ? 'The playground is at capacity for today'
      : scope === 'burst'
        ? 'Too many builds in a short time'
        : 'Daily generation limit reached';
  return new ApiError(429, message, { code: 'over_quota', scope, limit, used, resetsAt });
}

// Atomic $inc + read on the unique (userId, dateKey) index. Two first-of-the-day
// upserts can race the unique index; the loser retries as a plain $inc.
async function bumpDaily(userId, dateKey, delta) {
  try {
    return await UsageCounter.findOneAndUpdate(
      { userId, dateKey },
      { $inc: { count: delta } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      return UsageCounter.findOneAndUpdate({ userId, dateKey }, { $inc: { count: delta } }, { new: true });
    }
    throw err;
  }
}

async function bumpGlobal(dateKey, delta) {
  try {
    return await GlobalUsageCounter.findOneAndUpdate(
      { dateKey },
      { $inc: { count: delta } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      return GlobalUsageCounter.findOneAndUpdate({ dateKey }, { $inc: { count: delta } }, { new: true });
    }
    throw err;
  }
}

// Charge one generation at commit-to-build. Each counter is an atomic $inc-then-
// read: the request that pushes a counter past its cap is the one refunded and
// rejected, so concurrent requests can never overshoot. A no-op/question answer
// returns before this runs (free); the fix-loop never calls it (free); a refine
// or fresh build reaches here and counts.
async function chargeGeneration(userId) {
  const dateKey = utcDateKey();
  const userLimit = perUserDailyLimit();
  const globalLimit = globalDailyLimit();
  const resetsAt = nextUtcMidnight();

  const userCount = (await bumpDaily(userId, dateKey, 1)).count;
  if (userCount > userLimit) {
    await bumpDaily(userId, dateKey, -1);
    throw overQuota('user', userLimit, userLimit, resetsAt);
  }

  const globalCount = (await bumpGlobal(dateKey, 1)).count;
  if (globalCount > globalLimit) {
    // Global is full — refund both this request's charges before rejecting.
    await bumpGlobal(dateKey, -1);
    await bumpDaily(userId, dateKey, -1);
    throw overQuota('global', globalLimit, globalLimit, resetsAt);
  }
}

// Per-user sliding-minute burst guard, in front of /generate. Stops endpoint
// scripting without touching normal human pace. Surfaces the same over_quota
// shape the client already handles (no FE change). validate:false because we key
// by authenticated user, not IP, so the library's proxy/IP checks don't apply.
const burstLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => burstPerMinute(),
  keyGenerator: (req) => String((req.user && req.user._id) || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, _res, next) =>
    next(
      overQuota(
        'burst',
        req.rateLimit.limit,
        req.rateLimit.used,
        req.rateLimit.resetTime ? req.rateLimit.resetTime.toISOString() : nextUtcMidnight()
      )
    ),
});

module.exports = { chargeGeneration, burstLimiter, utcDateKey };
