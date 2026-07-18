const test = require('node:test');
const assert = require('node:assert');

const {
  deliverMeta,
  classifyComponent,
  sizeKbOf,
  gatesFrom,
  titleFrom,
} = require('../src/ai/deliver');

test('classifyComponent recognises the OTP component from code or plan', () => {
  assert.equal(classifyComponent('<Input.Otp length={6} />', ''), 'otp');
  assert.equal(classifyComponent('', 'A one-time passcode entry'), 'otp');
  assert.equal(classifyComponent('<table><thead/></table>', ''), 'table');
  assert.equal(classifyComponent('<form onSubmit={fn}/>', ''), 'form');
  assert.equal(classifyComponent('<Card>hi</Card>', ''), 'card');
  assert.equal(classifyComponent('<div/>', 'a plain widget'), 'other');
});

test('sizeKbOf is a positive gzipped KB for real code, 0 for empty', () => {
  assert.equal(sizeKbOf(''), 0);
  assert.equal(sizeKbOf(null), 0);
  const kb = sizeKbOf('export default function C(){ return null; }'.repeat(40));
  assert.ok(kb > 0);
  assert.equal(kb, Math.round(kb * 10) / 10, 'rounded to one decimal');
});

test('gatesFrom maps verify/qa outcomes to per-gate booleans', () => {
  assert.deepEqual(gatesFrom('passed', 'looks_good'), {
    lint: true, types: true, render: true, qa: true,
  });
  assert.deepEqual(gatesFrom('passed_after_fix', 'fixed'), {
    lint: true, types: true, render: true, qa: true,
  });
  // QA didn't run (null verdict, e.g. single-tier) → treated as passed.
  assert.deepEqual(gatesFrom('passed', null), {
    lint: true, types: true, render: true, qa: true,
  });
  // Verify exhausted → every verify-derived gate fails.
  assert.deepEqual(gatesFrom('delivered_with_warnings', 'looks_good'), {
    lint: false, types: false, render: false, qa: true,
  });
  // QA flagged issues it couldn't fix.
  assert.equal(gatesFrom('passed', 'delivered_with_warnings').qa, false);
});

test('titleFrom uses the first words of the request', () => {
  assert.equal(titleFrom('Build a 6-digit OTP verification input', 'otp'), 'Build a 6-digit OTP verification input');
  assert.equal(titleFrom('Build a really long dashboard with many many sections', 'other'), 'Build a really long dashboard with');
  assert.equal(titleFrom('', 'otp'), 'OTP component');
  assert.equal(titleFrom('', 'other'), 'Component');
});

test('deliverMeta returns every C2 projection field', () => {
  const meta = deliverMeta({
    code: 'import { Input } from "@chumlab/ui";\nexport default () => <Input.Otp length={6}/>;',
    plan: 'An OTP verification card',
    request: 'Build a 6-digit OTP verification input',
    verifyStatus: 'passed',
    qaVerdict: 'looks_good',
  });
  assert.equal(meta.componentType, 'otp');
  assert.equal(typeof meta.sizeKb, 'number');
  assert.equal(meta.a11y, 'AA');
  assert.equal(meta.gatesPassed, true);
  assert.equal(typeof meta.title, 'string');
  assert.deepEqual(Object.keys(meta.gates).sort(), ['lint', 'qa', 'render', 'types']);
});

test('deliverMeta drops the a11y badge when a gate fails', () => {
  const meta = deliverMeta({
    code: '<div/>',
    plan: '',
    request: 'x',
    verifyStatus: 'delivered_with_warnings',
    qaVerdict: null,
  });
  assert.equal(meta.gatesPassed, false);
  assert.equal(meta.a11y, null);
});
