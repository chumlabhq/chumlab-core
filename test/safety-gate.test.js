const test = require('node:test');
const assert = require('node:assert');
const { checkSafety } = require('../src/ai/verify/checks/safety');
const { verify } = require('../src/ai/verify');

test('safety flags hateful/harassing content', () => {
  assert.ok(checkSafety('<p>you stupid retard</p>').length);
});

test('safety passes a benign generic login form', () => {
  assert.equal(checkSafety('<input type="password" />\n<button>Sign in</button>').length, 0);
});

test('safety passes a legit brand login with no phishing language', () => {
  assert.equal(checkSafety('<h1>Sign in to PayPal</h1>\n<input type="password" />').length, 0);
});

test('safety flags brand impersonation in a phishing context', () => {
  const code =
    '<h1>PayPal</h1><p>Unusual activity detected — verify your identity to restore access.</p><input type="password" />';
  assert.ok(checkSafety(code).length);
});

test('verify blocks unsafe generated output (content policy)', async () => {
  const code =
    'import { Button } from "@chumlab/ui";\nexport default function C() { return <Button>go retard</Button>; }';
  const result = await verify(code);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.kind === 'safety'));
  const c = result.checks.find((c) => /content policy/i.test(c.text));
  assert.ok(c && c.ok === false);
});
