const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { chargeGeneration, burstLimiter, utcDateKey } = require('../src/middleware/quota');
const UsageCounter = require('../src/models/UsageCounter');
const GlobalUsageCounter = require('../src/models/GlobalUsageCounter');

let mongod;
const dateKey = utcDateKey();

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await UsageCounter.deleteMany({});
  await GlobalUsageCounter.deleteMany({});
  delete process.env.PLAYGROUND_DAILY_LIMIT;
  delete process.env.PLAYGROUND_GLOBAL_DAILY_LIMIT;
  delete process.env.PLAYGROUND_BURST_PER_MINUTE;
});

const newId = () => new mongoose.Types.ObjectId();
const userCount = async (uid) =>
  (await UsageCounter.findOne({ userId: uid, dateKey }))?.count ?? 0;
const globalCount = async () =>
  (await GlobalUsageCounter.findOne({ dateKey }))?.count ?? 0;

test('chargeGeneration increments both the per-user and global counters', async () => {
  const uid = newId();
  await chargeGeneration(uid);
  assert.equal(await userCount(uid), 1);
  assert.equal(await globalCount(), 1);
});

test('per-user daily cap → 429 once the limit is exceeded, counter rests at the cap', async () => {
  process.env.PLAYGROUND_DAILY_LIMIT = '2';
  const uid = newId();
  await chargeGeneration(uid);
  await chargeGeneration(uid);
  await assert.rejects(chargeGeneration(uid), (err) => {
    assert.equal(err.statusCode, 429);
    assert.equal(err.details.code, 'over_quota');
    assert.equal(err.details.scope, 'user');
    assert.equal(err.details.limit, 2);
    return true;
  });
  assert.equal(await userCount(uid), 2, 'refunded — never overshoots the cap');
  assert.equal(await globalCount(), 2, 'the rejected charge never reached global');
});

test('global daily cap → 429, and the global counter rests at the cap', async () => {
  process.env.PLAYGROUND_GLOBAL_DAILY_LIMIT = '2';
  const a = newId();
  const b = newId();
  const c = newId();
  await chargeGeneration(a);
  await chargeGeneration(b);
  await assert.rejects(chargeGeneration(c), (err) => {
    assert.equal(err.statusCode, 429);
    assert.equal(err.details.scope, 'global');
    assert.equal(err.details.limit, 2);
    return true;
  });
  assert.equal(await globalCount(), 2, 'global rests at the cap, no overshoot');
  assert.equal(await userCount(c), 0, 'the rejected user was refunded to zero');
});

test('concurrent charges at the global boundary cannot overshoot', async () => {
  process.env.PLAYGROUND_GLOBAL_DAILY_LIMIT = '1';
  const a = newId();
  const b = newId();
  const results = await Promise.allSettled([chargeGeneration(a), chargeGeneration(b)]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  assert.equal(ok, 1, 'exactly one of the two concurrent charges succeeds');
  assert.equal(rejected, 1);
  assert.equal(await globalCount(), 1, 'atomic $inc holds the cap under concurrency');
});

test('burst limiter allows up to the per-minute limit, then 429s', async () => {
  process.env.PLAYGROUND_BURST_PER_MINUTE = '10';
  const req = { user: { _id: 'burst-user-a' }, ip: '10.0.0.1' };
  const res = { setHeader() {}, getHeader() {}, headersSent: false };
  const call = () => new Promise((resolve) => burstLimiter(req, res, (err) => resolve(err)));

  for (let i = 0; i < 10; i++) {
    const err = await call();
    assert.equal(err, undefined, `call ${i + 1} within the limit is allowed`);
  }
  const blocked = await call();
  assert.ok(blocked, 'the 11th call in the window is rejected');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.details.code, 'over_quota');
  assert.equal(blocked.details.scope, 'burst');
});
