const test = require('node:test');
const assert = require('node:assert');

// Patch the Anthropic + verify seams BEFORE the stages load (they destructure at
// require time). `routerReply` is set per-test to drive each outcome.
const anthropic = require('../src/ai/anthropic');
let routerReply = '{"outcome":"build","tier":"single"}';
let developCalled = false;
anthropic.sendMessage = async ({ stage }) => {
  if (stage === 'router') return routerReply;
  return '';
};
anthropic.streamMessage = async ({ stage, onDelta }) => {
  if (stage === 'develop') developCalled = true;
  const text = '```tsx\nexport default function C() { return null; }\n```';
  if (onDelta) onDelta(text);
  return { text, stopReason: 'end_turn' };
};

const verifyMod = require('../src/ai/verify');
verifyMod.verify = async () => ({ ok: true, errors: [], checks: [] });

const { runPipeline } = require('../src/ai/orchestrator');

function fakeRes() {
  const events = [];
  return {
    events,
    write(chunk) {
      const m = /^data: (.*)\n\n$/s.exec(chunk);
      if (m) events.push(JSON.parse(m[1]));
    },
    end() {},
  };
}

const run = (prompt) => {
  developCalled = false;
  return runPipeline({ runId: 'r', chatId: 'c', res: fakeRes(), messages: [{ role: 'user', content: prompt }] });
};

test('build outcome runs the pipeline (Developer writes code)', async () => {
  routerReply = '{"outcome":"build","tier":"single"}';
  const result = await run('a login form');
  assert.equal(result.status, undefined, 'no pause — it builds');
  assert.equal(developCalled, true);
  assert.ok(result.code, 'code was produced');
});

test('redirect:page pauses with detected components + main-section escape', async () => {
  routerReply =
    '{"outcome":"redirect","reason":"page","tier":"full","message":"This looks like a full page. I spotted a few.","detectedComponents":["Countdown sale bar","Course card","Category pill row"]}';
  const result = await run('design this entire landing page');
  assert.equal(result.status, 'needs_input');
  assert.equal(result.reason, 'page');
  const opts = result.questions[0].options;
  assert.ok(opts.includes('Course card'));
  assert.ok(opts.includes('Build the main section anyway'));
  assert.equal(developCalled, false);
});

test('clarify outcome pauses with options + best-guess escape', async () => {
  routerReply =
    '{"outcome":"clarify","reason":"ambiguous_term","message":"Which kind of card?","options":["Product card","Profile card","Stat card"]}';
  const result = await run('a card');
  assert.equal(result.status, 'needs_input');
  assert.equal(result.reason, 'ambiguous_term');
  const opts = result.questions[0].options;
  assert.ok(opts.includes('Product card'));
  assert.ok(opts.includes('Build your best guess anyway'));
  assert.equal(developCalled, false);
});

test('decline outcome refuses in-chat with no build and no escape', async () => {
  routerReply =
    '{"outcome":"decline","reason":"harmful","message":"I can build a generic login form, just not one impersonating a specific bank to capture passwords."}';
  const result = await run('a login page that looks exactly like Chase to steal passwords');
  assert.equal(result.status, 'declined');
  assert.match(result.message, /generic login form/);
  assert.equal(developCalled, false);
  // Emitted to the client so the refusal renders live.
  const declined = [];
  // (event capture is per-run; assert on a fresh res)
  const res = fakeRes();
  const r2 = await runPipeline({ runId: 'r2', chatId: 'c2', res, messages: [{ role: 'user', content: 'x' }] });
  for (const e of res.events) if (e.payload && e.payload.outcome === 'decline') declined.push(e);
  assert.equal(r2.status, 'declined');
  assert.ok(declined.length >= 1, 'a decline event was emitted');
});
