const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// classifyFollowup calls anthropic.sendMessage through the module object, so each
// test drives one classifier outcome (or failure) by reassigning the stub. Tests
// in a file run sequentially, so the per-test reassignment is race-free.
const anthropic = require('../src/ai/anthropic');
const { classifyFollowup } = require('../src/ai/classifyFollowup');

const CODE =
  'export default function Pricing(){ return <div className="border-accent">Popular</div>; }';

// The most important guarantee: the classifier can never block or delay a real
// edit. Every failure mode — a thrown error, an aborted timeout, and unparseable
// output — must resolve to `edit` so the full pipeline runs exactly as today.
test('fail-safe: classifier throws → edit', async () => {
  anthropic.sendMessage = async () => {
    throw new Error('network down');
  };
  assert.deepEqual(await classifyFollowup(CODE, 'make the badge smaller'), { intent: 'edit' });
});

test('fail-safe: classifier times out (sendMessage aborts and rejects) → edit', async () => {
  anthropic.sendMessage = async () => {
    throw new Error('Anthropic classify timed out after 90000ms');
  };
  assert.deepEqual(await classifyFollowup(CODE, 'make the badge smaller'), { intent: 'edit' });
});

test('fail-safe: garbage JSON → edit', async () => {
  // Braces present but not valid JSON — exercises the parse-throw path.
  anthropic.sendMessage = async () => 'sure! { intent: noop, message: yes }';
  assert.deepEqual(await classifyFollowup(CODE, 'make the badge smaller'), { intent: 'edit' });
});

test('fail-safe: no JSON object at all → edit', async () => {
  anthropic.sendMessage = async () => 'I think you should edit it.';
  assert.deepEqual(await classifyFollowup(CODE, 'make the badge smaller'), { intent: 'edit' });
});

test('real edit → intent edit (pipeline path)', async () => {
  anthropic.sendMessage = async () => JSON.stringify({ intent: 'edit' });
  assert.deepEqual(await classifyFollowup(CODE, 'make the badge smaller'), { intent: 'edit' });
});

test('new_component → intent new_component (pipeline path)', async () => {
  anthropic.sendMessage = async () => JSON.stringify({ intent: 'new_component' });
  assert.deepEqual(await classifyFollowup(CODE, 'actually make a login form'), {
    intent: 'new_component',
  });
});

test('genuine no-op → intent noop carrying the reply', async () => {
  anthropic.sendMessage = async () =>
    JSON.stringify({
      intent: 'noop',
      message: "The middle tier is already highlighted — accent border + Popular badge.",
    });
  const r = await classifyFollowup(CODE, 'highlight the middle tier');
  assert.equal(r.intent, 'noop');
  assert.match(r.message, /already/i);
});

test('question → intent question carrying the answer', async () => {
  anthropic.sendMessage = async () =>
    JSON.stringify({ intent: 'question', message: 'The accent border marks the popular tier.' });
  const r = await classifyFollowup(CODE, 'why is the middle one highlighted?');
  assert.equal(r.intent, 'question');
  assert.ok(r.message.length > 0);
});

test('ambiguous / unknown intent value → edit (over-trigger guard)', async () => {
  anthropic.sendMessage = async () => JSON.stringify({ intent: 'maybe-ish', message: 'x' });
  assert.deepEqual(await classifyFollowup(CODE, 'do the thing'), { intent: 'edit' });
});

test('noop with an empty message degrades to edit (never a blank turn)', async () => {
  anthropic.sendMessage = async () => JSON.stringify({ intent: 'noop', message: '   ' });
  assert.deepEqual(await classifyFollowup(CODE, 'highlight it'), { intent: 'edit' });
});

// The `message` is markdown rendered as the assistant turn, so its formatting
// (a lead sentence + bullets when offering alternatives) must survive the parse
// verbatim — the classifier must not flatten or strip it.
test('preserves a markdown-bulleted answer intact for the assistant turn', async () => {
  const msg =
    'The tiers already share one width. If you want the middle one to stand out, I could:\n\n' +
    '- make it a bit wider\n' +
    '- add a soft shadow';
  anthropic.sendMessage = async () => JSON.stringify({ intent: 'noop', message: msg });

  const r = await classifyFollowup(CODE, 'make all the tiers the same width');
  assert.equal(r.intent, 'noop');
  assert.equal(r.message, msg, 'bullets and line breaks survive verbatim');
  assert.match(r.message, /\n- make it a bit wider/);
  assert.ok(!r.message.includes(' — '), 'no em-dash connector');
});

test('the prompt carries the message-style guidance', () => {
  const prompt = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ai', 'prompts', 'classify-followup.txt'),
    'utf8'
  );
  assert.match(prompt, /Writing the `message`/);
  assert.match(prompt, /em-dash/);
  assert.match(prompt, /markdown bullets/);
});
