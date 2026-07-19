const test = require('node:test');
const assert = require('node:assert');
const { parseRouterReply } = require('../src/ai/stages/router');

test('router parses a build verdict', () => {
  assert.deepEqual(parseRouterReply('{"outcome":"build","tier":"single"}'), {
    outcome: 'build',
    tier: 'single',
    reason: null,
    message: null,
    options: [],
    detectedComponents: [],
  });
});

test('router parses a page redirect with detected components', () => {
  const r = parseRouterReply(
    '{"outcome":"redirect","reason":"page","message":"This looks like a full page.","tier":"full","detectedComponents":["Nav","Hero","Card grid"]}'
  );
  assert.equal(r.outcome, 'redirect');
  assert.equal(r.reason, 'page');
  assert.match(r.message, /full page/);
  assert.deepEqual(r.detectedComponents, ['Nav', 'Hero', 'Card grid']);
});

test('router parses a clarify verdict with options', () => {
  const r = parseRouterReply(
    '{"outcome":"clarify","reason":"ambiguous_term","message":"Which kind of card?","options":["Product card","Profile card","Stat card"]}'
  );
  assert.equal(r.outcome, 'clarify');
  assert.equal(r.reason, 'ambiguous_term');
  assert.equal(r.options.length, 3);
});

test('router parses a decline verdict', () => {
  const r = parseRouterReply(
    '{"outcome":"decline","reason":"harmful","message":"I can build a generic login form, just not one impersonating a bank."}'
  );
  assert.equal(r.outcome, 'decline');
  assert.equal(r.reason, 'harmful');
  assert.match(r.message, /generic login form/);
});

test('router falls back to null on unparseable output', () => {
  assert.equal(parseRouterReply('not json at all'), null);
});

test('router coerces an unknown outcome/tier to the build default', () => {
  const r = parseRouterReply('{"outcome":"explode","tier":"huge"}');
  assert.equal(r.outcome, 'build');
  assert.equal(r.tier, 'single');
});

// Never a dead end: a non-build outcome with nothing usable degrades to build.
test('router degrades a message-less non-build outcome to build', () => {
  assert.equal(parseRouterReply('{"outcome":"clarify","reason":"vague"}').outcome, 'build');
});

test('router degrades a page redirect with no detected components to build', () => {
  assert.equal(
    parseRouterReply('{"outcome":"redirect","reason":"page","message":"x","detectedComponents":[]}').outcome,
    'build'
  );
});

test('router clamps options/detectedComponents and drops non-strings', () => {
  const r = parseRouterReply(
    '{"outcome":"redirect","reason":"page","message":"x","detectedComponents":["a","b","c","d","e","f",1,null,"  "]}'
  );
  assert.equal(r.detectedComponents.length, 5);
  assert.ok(r.detectedComponents.every((c) => typeof c === 'string' && c.trim()));
});
