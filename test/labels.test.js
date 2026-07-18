const test = require('node:test');
const assert = require('node:assert');

const { STAGE_LABELS, labelFor } = require('../src/ai/labels');

test('every pipeline stage has a human-readable label', () => {
  for (const stage of ['router', 'clarify', 'plan', 'develop', 'verify', 'qa', 'deliver']) {
    const label = labelFor(stage);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, `${stage} label is non-empty`);
    assert.equal(label, STAGE_LABELS[stage]);
  }
});

test('labelFor returns null for an unknown stage (never throws)', () => {
  assert.equal(labelFor('nope'), null);
  assert.equal(labelFor(undefined), null);
});
