const test = require('node:test');
const assert = require('node:assert');

const { STAGE_LABELS, labelFor } = require('../src/ai/labels');

test('every running stage has a human-readable label', () => {
  // 'clarify' is intentionally absent: it's a needs_input pause, not a running
  // stage with a streamed label line (the client shows "Waiting for you").
  for (const stage of ['router', 'plan', 'develop', 'verify', 'qa', 'deliver']) {
    const label = labelFor(stage);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, `${stage} label is non-empty`);
    assert.equal(label, STAGE_LABELS[stage]);
  }
});

test('labelFor returns null for a non-labeled or unknown stage (never throws)', () => {
  assert.equal(labelFor('clarify'), null);
  assert.equal(labelFor('nope'), null);
  assert.equal(labelFor(undefined), null);
});
