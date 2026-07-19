const test = require('node:test');
const assert = require('node:assert');

const { playgroundAccessGranted } = require('../src/middleware/auth');

// Access is open to everyone by default; the invite gate is opt-in via env.
test('open access (default): every authenticated user is granted, record or not', () => {
  delete process.env.PLAYGROUND_INVITE_ONLY;
  assert.equal(playgroundAccessGranted(null), true);
  assert.equal(playgroundAccessGranted({ status: 'waiting' }), true);
  assert.equal(playgroundAccessGranted({ status: 'onboarded' }), true);
});

test('invite-only mode gates on the onboarding status', () => {
  process.env.PLAYGROUND_INVITE_ONLY = 'true';
  try {
    assert.equal(playgroundAccessGranted(null), false);
    assert.equal(playgroundAccessGranted({ status: 'waiting' }), false);
    assert.equal(playgroundAccessGranted({ status: 'rejected' }), false);
    assert.equal(playgroundAccessGranted({ status: 'invited' }), true);
    assert.equal(playgroundAccessGranted({ status: 'onboarded' }), true);
  } finally {
    delete process.env.PLAYGROUND_INVITE_ONLY;
  }
});
