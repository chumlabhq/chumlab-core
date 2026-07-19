const test = require('node:test');
const assert = require('node:assert');
const { staticResponsiveCheck } = require('../src/ai/verify/checks/responsive');
const { verify } = require('../src/ai/verify');

test('static check fails a fixed Tailwind width beyond mobile', () => {
  assert.equal(staticResponsiveCheck('<div className="w-[1200px]" />').length, 1);
});

test('static check fails min-w and CSS/JSX fixed widths', () => {
  assert.ok(staticResponsiveCheck('<div className="min-w-[800px]" />').length);
  assert.ok(staticResponsiveCheck('const s = `width: 1200px`;').length);
  assert.ok(staticResponsiveCheck('<div style={{ width: "1200px" }} />').length);
});

// The recommended fluid pattern (max-width / max-w-[…]) must NOT trip the gate —
// a false positive here would contradict the develop-prompt mandate.
test('static check passes the fluid max-width pattern', () => {
  assert.equal(staticResponsiveCheck('<div className="w-full max-w-[1200px]" />').length, 0);
  assert.equal(staticResponsiveCheck('const s = `max-width: 1200px`;').length, 0);
  assert.equal(staticResponsiveCheck('<div style={{ maxWidth: "1200px" }} />').length, 0);
});

test('static check ignores widths that fit mobile', () => {
  assert.equal(staticResponsiveCheck('<div className="w-[320px]" />').length, 0);
  assert.equal(staticResponsiveCheck('<div className="w-full" />').length, 0);
});

test('verify blocks a component with a fixed 1200px width', async () => {
  const code =
    'import { Button } from "@chumlab/ui";\n' +
    'export default function C() { return <Button className="w-[1200px]">Go</Button>; }';
  const result = await verify(code);
  assert.equal(result.ok, false);
  const respCheck = result.checks.find((c) => /responsive/i.test(c.text));
  assert.ok(respCheck && respCheck.ok === false, 'the responsive check reports failure');
  assert.ok(result.errors.some((e) => e.kind === 'responsive'), 'a responsive error is raised');
});

test('verify passes a fluid component through the responsive gate', async () => {
  const code =
    'import { Button } from "@chumlab/ui";\n' +
    'export default function C() { return <Button className="w-full max-w-md">Go</Button>; }';
  const result = await verify(code);
  const respCheck = result.checks.find((c) => /responsive/i.test(c.text));
  assert.ok(respCheck && respCheck.ok === true, 'the responsive check passes');
});
