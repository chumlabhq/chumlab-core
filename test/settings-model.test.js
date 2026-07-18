const test = require('node:test');
const assert = require('node:assert');

// Pure model surface — the DB-backed GET/PATCH round-trip runs against Mongo in
// the manual smoke (no in-memory Mongo dependency is added to the repo here).
const PlaygroundSettings = require('../src/models/PlaygroundSettings');

test('settings defaults are light / mobile (C4)', () => {
  assert.deepEqual(PlaygroundSettings.DEFAULTS, { previewTheme: 'light', previewDevice: 'mobile' });
});

test('settings enums are appearance-only — no gate flags', () => {
  assert.deepEqual(PlaygroundSettings.PREVIEW_THEMES, ['light', 'dark', 'system']);
  assert.deepEqual(PlaygroundSettings.PREVIEW_DEVICES, ['mobile', 'tablet', 'fill']);
});

test('a new settings doc materialises the defaults', () => {
  const doc = new PlaygroundSettings({ userId: '507f1f77bcf86cd799439011' });
  assert.equal(doc.previewTheme, 'light');
  assert.equal(doc.previewDevice, 'mobile');
});
