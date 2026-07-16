const UsageCounter = require('../models/UsageCounter');
const ApiError = require('../utils/ApiError');

const DEFAULT_DAILY_LIMIT = 20;

function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}

async function incrementCounter(userId, dateKey) {
  try {
    return await UsageCounter.findOneAndUpdate(
      { userId, dateKey },
      { $inc: { count: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Two first-of-the-day requests can race the upsert into the unique
    // index; the loser retries as a plain $inc on the winner's document.
    if (err && err.code === 11000) {
      return UsageCounter.findOneAndUpdate(
        { userId, dateKey },
        { $inc: { count: 1 } },
        { new: true }
      );
    }
    throw err;
  }
}

async function perUserQuota(req, _res, next) {
  try {
    const limit =
      parseInt(process.env.PLAYGROUND_DAILY_LIMIT, 10) || DEFAULT_DAILY_LIMIT;
    const dateKey = utcDateKey();
    const counter = await incrementCounter(req.user._id, dateKey);

    if (counter.count > limit) {
      throw new ApiError(429, 'Daily generation limit reached', {
        code: 'over_quota',
        limit,
        used: counter.count,
        resetsAt: nextUtcMidnight(),
      });
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { perUserQuota };
