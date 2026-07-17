const fs = require('fs');
const path = require('path');
const { sendEvent } = require('./sse');
const { verify } = require('./verify');
const { toUserContent } = require('../services/assets');

const stages = {
  router: require('./stages/router'),
  clarify: require('./stages/clarify'),
  plan: require('./stages/plan'),
  develop: require('./stages/develop'),
  qa: require('./stages/qa'),
};

// Shared budget across server-side (lint/type) and client-reported (render)
// fix rounds - the render fix endpoint resumes against the same counter.
// TODO(phase-10 eval): regression test - mixed-gate exhaustion (lint-fail ->
// type-fail -> type-fail) must cap at 3 total model calls, one shared budget.
const MAX_FIX_ROUNDS = 2;

// Output budgets scale with the routed tier - a full-tier dashboard is 500+
// lines and blows through the old fixed 8192 cap mid-JSX. A truncated
// attempt retries once at double the budget before failing.
const OUTPUT_BUDGETS = { trivial: 8192, single: 8192, multi: 16384, full: 32000 };
const MAX_OUTPUT_TOKENS = parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS, 10) || 64000;

const FIX_PROMPT_PATH = path.join(__dirname, 'prompts', 'fix.txt');
const BUILD_FROM_PLAN_PATH = path.join(__dirname, 'prompts', 'build-from-plan.txt');
const QA_FIX_PROMPT_PATH = path.join(__dirname, 'prompts', 'qa-fix.txt');

let cachedFixPrompt = null;
let cachedBuildFromPlan = null;
let cachedQaFixPrompt = null;

function fixPrompt() {
  if (cachedFixPrompt) return cachedFixPrompt;
  cachedFixPrompt = fs.readFileSync(FIX_PROMPT_PATH, 'utf8').trim();
  return cachedFixPrompt;
}

function buildFromPlanPrompt() {
  if (cachedBuildFromPlan) return cachedBuildFromPlan;
  cachedBuildFromPlan = fs.readFileSync(BUILD_FROM_PLAN_PATH, 'utf8').trim();
  return cachedBuildFromPlan;
}

function qaFixPrompt() {
  if (cachedQaFixPrompt) return cachedQaFixPrompt;
  cachedQaFixPrompt = fs.readFileSync(QA_FIX_PROMPT_PATH, 'utf8').trim();
  return cachedQaFixPrompt;
}

function buildFixMessage(errors) {
  const lines = errors.map(
    (e) => `- [${e.kind}]${e.loc ? ` ${e.loc}` : ''} ${e.message}`
  );
  return `${fixPrompt()}\n\nErrors:\n${lines.join('\n')}`;
}

function buildQaFixMessage(findings) {
  const lines = findings.map(
    (f) => `- [${f.severity}]${f.location ? ` ${f.location}` : ''} ${f.description}`
  );
  return `${qaFixPrompt()}\n\nReview findings:\n${lines.join('\n')}`;
}

function extractCode(text) {
  const start = text.indexOf('```tsx');
  if (start === -1) return null;
  const body = text.slice(start + 6).replace(/^\n/, '');
  const end = body.indexOf('```');
  return (end === -1 ? body : body.slice(0, end)).trim() || null;
}

// Router -> (plan for multi/full) -> develop -> verify (lint -> typecheck),
// auto-fixing deterministic failures until the shared round budget runs out.
// Render errors re-enter through the fix endpoint with `roundsUsed` primed
// from the run document. Semantic/visual review is the Phase 7 QA critic,
// not this loop.
async function runPipeline(ctx) {
  const { res, runId } = ctx;
  let messages = ctx.messages;
  let roundsUsed = ctx.roundsUsed || 0;
  const attempts = [];
  // Fix and resume continuations carry the original run's tier so a large
  // file gets the same output budget the build did.
  let tier = ctx.tier || null;
  let plan = null;
  let assumptions = ctx.assumptions || '';
  // The raw request for the QA critic - captured before the round-0 block
  // folds the plan into the last message.
  const request = (messages[messages.length - 1] || {}).content || '';
  let qaVerdict = null;
  let qaFindings = [];
  let qaFixed = false;

  // Fix continuations arrive with roundsUsed primed; resume continuations set
  // `resumed` - both skip router/clarify (the path was already chosen).
  const image = ctx.image || null;

  if (roundsUsed === 0 && !ctx.resumed) {
    const lastUser = messages[messages.length - 1];
    const hasPriorCode = messages.some(
      (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('```tsx')
    );
    // The screenshot informs the tier (a full page routes multi/full).
    tier = await stages.router.run({ runId, res, prompt: lastUser.content, hasPriorCode, image });

    // Clarify only where the answer could change the whole build, and never
    // on a follow-up edit to existing code.
    if ((tier === 'multi' || tier === 'full') && !hasPriorCode) {
      const decision = await stages.clarify.run({ runId, res, prompt: lastUser.content, image });
      if (decision.questions.length) {
        return {
          status: 'needs_input',
          questions: decision.questions,
          assumptions: decision.assumptions,
          tier,
          plan: null,
          roundsUsed,
          attempts,
        };
      }
      assumptions = decision.assumptions;
    }
  }

  if (roundsUsed === 0 && (tier === 'multi' || tier === 'full')) {
    const lastUser = messages[messages.length - 1];
    plan = await stages.plan.run({ runId, res, messages, image });
    const assumptionNote = assumptions
      ? `\n\nKey assumptions to state briefly in your plan: ${assumptions}`
      : '';
    messages = [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: `${lastUser.content}\n\n${buildFromPlanPrompt()}\n\nPlan:\n${plan}${assumptionNote}`,
      },
    ];
  }

  // Attach the screenshot to the current build turn so develop (and every fix
  // round) sees it. Only the system block is cached; the image lives in the
  // user turn, so caching is unaffected.
  if (roundsUsed === 0 && image) {
    const last = messages[messages.length - 1];
    messages = [
      ...messages.slice(0, -1),
      { role: last.role, content: toUserContent(last.content, image) },
    ];
  }

  let maxTokens = OUTPUT_BUDGETS[tier] || OUTPUT_BUDGETS.single;
  let truncationRetried = false;

  for (;;) {
    const { text, stopReason } = await stages.develop.run({ ...ctx, tier, messages, maxTokens });

    if (stopReason === 'max_tokens') {
      // Truncated mid-file - verifying it would only report the torn-off
      // JSX/strings at EOF. Retry once at double the budget, then fail clean.
      if (!truncationRetried) {
        truncationRetried = true;
        maxTokens = Math.min(maxTokens * 2, MAX_OUTPUT_TOKENS);
        continue;
      }
      throw new Error('Generation exceeded the output limit - try a narrower request');
    }

    const code = extractCode(text);

    if (!code) {
      // Prose answer - nothing for the gates to check.
      return { text, code: null, verifyStatus: null, errors: [], roundsUsed, attempts, tier, plan, truncationRetried };
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

      // Verify proves it compiles and mounts; QA judges whether it did what
      // was asked. Runs on multi/full only, in a separate context, and routes
      // real findings through the SAME bounded fix loop (shared roundsUsed).
      if (tier === 'multi' || tier === 'full') {
        sendEvent(res, { runId, stage: 'qa', status: 'start', payload: {} });
        const review = await stages.qa.run({ request, plan, code });
        const actionable = review.findings.filter(
          (f) => f.severity === 'high' || f.severity === 'medium'
        );

        if (actionable.length) {
          if (roundsUsed >= MAX_FIX_ROUNDS) {
            sendEvent(res, {
              runId,
              stage: 'qa',
              status: 'done',
              payload: { pass: false, exhausted: true, findings: actionable },
            });
            qaVerdict = 'delivered_with_warnings';
            qaFindings = actionable;
          } else {
            roundsUsed += 1;
            qaFixed = true;
            sendEvent(res, {
              runId,
              stage: 'qa',
              status: 'error',
              payload: { fixing: true, round: roundsUsed, findings: actionable },
            });
            messages = [
              ...messages,
              { role: 'assistant', content: text },
              { role: 'user', content: buildQaFixMessage(actionable) },
            ];
            continue;
          }
        } else {
          sendEvent(res, { runId, stage: 'qa', status: 'done', payload: { pass: true, fixed: qaFixed } });
          qaVerdict = qaFixed ? 'fixed' : 'looks_good';
        }
      }

      return {
        text,
        code,
        verifyStatus: roundsUsed > 0 ? 'passed_after_fix' : 'passed',
        errors: [],
        roundsUsed,
        attempts,
        tier,
        plan,
        truncationRetried,
        qaVerdict,
        qaFindings,
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
        tier,
        plan,
        truncationRetried,
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
