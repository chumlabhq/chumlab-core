const test = require('node:test');
const assert = require('node:assert');

// OTP-golden integration (A-side). Drives the REAL orchestrator and REAL stage
// modules end to end, mocking only the two external seams — the Anthropic client
// and the verify gates — so the run is deterministic and offline. node --test
// isolates each file in its own process, so these mutations don't leak.

const OTP_CODE = [
  'import { useState } from "react";',
  'import { Input } from "@chumlab/ui";',
  'export default function OtpCard() {',
  '  const [code, setCode] = useState("");',
  '  return <Input.Otp value={code} onChange={setCode} length={6} />;',
  '}',
].join('\n');

// Patch the Anthropic seam BEFORE the stages load (they destructure it at
// require time, which happens when the orchestrator is required below).
const anthropic = require('../src/ai/anthropic');
anthropic.sendMessage = async ({ stage }) => {
  if (stage === 'router') return '{"outcome":"build","tier":"multi"}';
  if (stage === 'clarify') return JSON.stringify({ questions: [], assumptions: 'Six-digit numeric code.' });
  if (stage === 'qa') return JSON.stringify({ findings: [] });
  return '';
};
anthropic.streamMessage = async ({ stage, onDelta }) => {
  if (stage === 'plan') {
    if (onDelta) onDelta('Plan: ');
    return { text: 'Build an OTP verification card using Input.Otp', stopReason: 'end_turn' };
  }
  const text = '```tsx\n' + OTP_CODE + '\n```';
  if (onDelta) onDelta(text);
  return { text, stopReason: 'end_turn' };
};

// Patch the gate seam so the run is env-independent. The check lines it returns
// are exactly what the panel streams as verify substeps.
let verifyCalls = 0;
const verifyMod = require('../src/ai/verify');
verifyMod.verify = () => {
  verifyCalls += 1;
  return {
    ok: true,
    errors: [],
    checks: [
      { text: 'No banned APIs, imports, or inline styles', ok: true },
      { text: 'Type-checks against @chumlab/ui', ok: true },
    ],
  };
};

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

test('OTP golden: labeled starts, verify substeps, 4-entry timeline, deliver metadata', async () => {
  const res = fakeRes();
  const result = await runPipeline({
    runId: 'test-run',
    chatId: 'chat-1',
    res,
    messages: [{ role: 'user', content: 'Build a 6-digit OTP verification input' }],
  });
  const { events } = res;

  // ≥1 labeled start per stage. The Router now owns routing (no separate
  // clarify stage), so clarify no longer emits its own start.
  for (const stage of ['router', 'plan', 'develop', 'verify', 'qa']) {
    const start = events.find((e) => e.stage === stage && e.status === 'start');
    assert.ok(start, `${stage} emitted a start`);
    assert.ok(start.payload && typeof start.payload.label === 'string' && start.payload.label.length, `${stage} start is labeled`);
  }

  // ≥2 verify substeps, each well-formed.
  const verifySubsteps = events.filter((e) => e.stage === 'verify' && e.status === 'substep');
  assert.ok(verifySubsteps.length >= 2, 'at least two verify substeps');
  for (const s of verifySubsteps) {
    assert.equal(typeof s.payload.text, 'string');
    assert.equal(typeof s.payload.ok, 'boolean');
  }

  // deliver terminal event carries the cluster metadata (C1).
  const deliver = events.find((e) => e.stage === 'deliver' && e.status === 'done');
  assert.ok(deliver, 'deliver.done emitted');
  assert.equal(typeof deliver.payload.sizeKb, 'number');
  assert.equal(deliver.payload.a11y, 'AA');
  assert.deepEqual(
    Object.keys(deliver.payload.gates).sort(),
    ['lint', 'qa', 'render', 'responsive', 'safety', 'types']
  );

  // Gates ran regardless of any settings (guarantee): verify + qa both executed.
  assert.ok(verifyCalls >= 1, 'the verify gate ran');
  assert.ok(events.some((e) => e.stage === 'qa'), 'the qa gate ran');

  // Persisted timeline is the 4 folded personas, in order.
  assert.ok(Array.isArray(result.timeline));
  assert.deepEqual(result.timeline.map((t) => t.agent), ['router', 'developer', 'verifier', 'qa']);
  for (const entry of result.timeline) {
    assert.equal(typeof entry.durationMs, 'number');
    assert.ok(Array.isArray(entry.steps) && entry.steps.length > 0, `${entry.agent} has steps`);
  }

  // deliver metadata folded onto the result for persistence / projection.
  assert.equal(result.deliverMeta.componentType, 'otp');
  assert.equal(result.deliverMeta.gatesPassed, true);
  assert.ok(typeof result.deliverMeta.title === 'string' && result.deliverMeta.title.length);
  assert.ok(typeof result.deliverMeta.sizeKb === 'number');
});
