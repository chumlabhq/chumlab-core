// Pass-through until Phase 1 lands UsageCounter-backed enforcement.
function perUserQuota(_req, _res, next) {
  next();
}

module.exports = { perUserQuota };
