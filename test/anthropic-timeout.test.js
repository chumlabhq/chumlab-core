const test = require('node:test');
const assert = require('node:assert');

const { withTimeout } = require('../src/ai/anthropic');

test('withTimeout rejects a hung call instead of hanging', async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(
      (signal) =>
        new Promise((_resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
      50,
      'Anthropic develop'
    ),
    /Anthropic develop timed out after 50ms/
  );
  assert.equal(aborted, true, 'the underlying request is aborted on timeout');
});

test('withTimeout resolves a fast call and clears the timer', async () => {
  const result = await withTimeout(async () => 'ok', 1000, 'Anthropic router');
  assert.equal(result, 'ok');
  // A dangling timer would keep the process alive; node --test flags that.
});
