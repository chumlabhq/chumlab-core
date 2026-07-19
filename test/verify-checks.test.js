const test = require('node:test');
const assert = require('node:assert');

// Real verify (no mocks) — proves the lint + type gates run unconditionally.
// There is no settings input to verify: gates are always-on (Decision 2). The
// render gate is the client-side third gate and is exercised in the FE suite.
const { verify } = require('../src/ai/verify');
const { checkIcons } = require('../src/ai/verify/icons');

test('verify streams a lint check and fails on a banned import', async () => {
  const bad = 'import x from "left-pad";\nexport default function C() { return null; }';
  const result = await verify(bad);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.checks), 'checks is an array');
  assert.equal(result.checks[0].ok, false, 'the lint check reports failure');
  assert.match(result.checks[0].text, /banned|import|API/i);
});

test('verify reaches the type gate once lint is clean', async () => {
  const good =
    'import { Button } from "@chumlab/ui";\n' +
    'export default function C() { return <Button>Go</Button>; }';
  const result = await verify(good);
  assert.equal(result.checks[0].ok, true, 'lint passed');
  // The type gate always records a check line — even when the type environment
  // is unavailable it is reported (skipped), never silently dropped.
  assert.ok(
    result.checks.some((c) => /Type-checks/i.test(c.text)),
    'a type-gate check line is present'
  );
  assert.ok(result.checks.length >= 2, 'both gates produced substep lines');
});

// The icon gate rides in the first check. Its verdict is validated against the
// local @iconify-json packs, so these are deterministic and offline.

test('checkIcons passes a real Iconify name', () => {
  const r = checkIcons('<Icon icon="lucide:mail" width={20} height={20} />');
  assert.equal(r.ok, true);
});

test('checkIcons fails a name that does not exist in Iconify', () => {
  const r = checkIcons('<Icon icon="lucide:not-a-real-icon" />');
  assert.equal(r.ok, false);
  assert.equal(r.repairable, true, 'an unresolved name is repairable');
  assert.match(r.errors[0].message, /does not exist/i);
});

test('checkIcons fails an inline <svg> icon', () => {
  const r = checkIcons('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>');
  assert.equal(r.ok, false);
  assert.equal(r.repairable, false, 'an inline svg cannot be auto-repaired');
  assert.match(r.errors[0].message, /svg/i);
});

test('checkIcons fails a raw icon-library import', () => {
  const r = checkIcons('import { Heart } from "@phosphor-icons/react";');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /icon.*library|@iconify/i);
});

test('verify fails deterministically on an inline <svg> (no repair round)', async () => {
  const svg =
    'export default function C() {\n' +
    '  return <svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>;\n' +
    '}';
  const result = await verify(svg);
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].ok, false, 'the first gate reports the icon failure');
});

test('verify passes a component that renders a real Iconify icon', async () => {
  const good =
    'import { Icon } from "@iconify/react";\n' +
    'export default function C() { return <Icon icon="lucide:search" width={20} height={20} />; }';
  const result = await verify(good);
  assert.equal(result.checks[0].ok, true, 'the icon + import gate passed');
});
