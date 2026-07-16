const fs = require('fs');
const path = require('path');
const { sendEvent } = require('./sse');
const { verify } = require('./verify');

const stages = {
  router: require('./stages/router'),
  clarify: require('./stages/clarify'),
  plan: require('./stages/plan'),
  develop: require('./stages/develop'),
  qa: require('./stages/qa'),
};

// Shared budget across server-side (lint/type) and client-reported (render)
// fix rounds - the render fix endpoint resumes against the same counter.
const MAX_FIX_ROUNDS = 2;

const FIX_PROMPT_PATH = path.join(__dirname, 'prompts', 'fix.txt');

let cachedFixPrompt = null;

function fixPrompt() {
  if (cachedFixPrompt) return cachedFixPrompt;
  cachedFixPrompt = fs.readFileSync(FIX_PROMPT_PATH, 'utf8').trim();
  return cachedFixPrompt;
}

function buildFixMessage(errors) {
  const lines = errors.map(
    (e) => `- [${e.kind}]${e.loc ? ` ${e.loc}` : ''} ${e.message}`
  );
  return `${fixPrompt()}\n\nErrors:\n${lines.join('\n')}`;
}

function extractCode(text) {
  const start = text.indexOf('```tsx');
  if (start === -1) return null;
  const body = text.slice(start + 6).replace(/^\n/, '');
  const end = body.indexOf('```');
  return (end === -1 ? body : body.slice(0, end)).trim() || null;
}

// Develop -> verify (lint -> typecheck), auto-fixing deterministic failures
// until the shared round budget runs out. Render errors re-enter through the
// fix endpoint with `roundsUsed` primed from the run document. Semantic/
// visual review is the Phase 7 QA critic, not this loop.
async function runPipeline(ctx) {
  const { res, runId } = ctx;
  let messages = ctx.messages;
  let roundsUsed = ctx.roundsUsed || 0;
  const attempts = [];

  for (;;) {
    const text = await stages.develop.run({ ...ctx, messages });
    const code = extractCode(text);

    if (!code) {
      // Prose answer - nothing for the gates to check.
      return { text, code: null, verifyStatus: null, errors: [], roundsUsed, attempts };
    }

    sendEvent(res, { runId, stage: 'verify', status: 'start', payload: { round: roundsUsed } });
    const result = verify(code);
    attempts.push({
      round: roundsUsed,
      ok: result.ok,
      errors: result.errors,
      ...(result.typecheckUnavailable ? { typecheckUnavailable: true } : {}),
    });

    if (result.ok) {
      sendEvent(res, {
        runId,
        stage: 'verify',
        status: 'done',
        payload: {
          pass: true,
          round: roundsUsed,
          ...(result.typecheckUnavailable ? { typecheckUnavailable: true } : {}),
        },
      });
      return {
        text,
        code,
        verifyStatus: roundsUsed > 0 ? 'passed_after_fix' : 'passed',
        errors: [],
        roundsUsed,
        attempts,
      };
    }

    if (roundsUsed >= MAX_FIX_ROUNDS) {
      sendEvent(res, {
        runId,
        stage: 'verify',
        status: 'done',
        payload: { pass: false, exhausted: true, round: roundsUsed, errors: result.errors },
      });
      return {
        text,
        code,
        verifyStatus: 'delivered_with_warnings',
        errors: result.errors,
        roundsUsed,
        attempts,
      };
    }

    roundsUsed += 1;
    sendEvent(res, {
      runId,
      stage: 'verify',
      status: 'error',
      payload: { fixing: true, round: roundsUsed, errors: result.errors },
    });
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: buildFixMessage(result.errors) },
    ];
  }
}

module.exports = { stages, runPipeline, buildFixMessage, extractCode, MAX_FIX_ROUNDS };
