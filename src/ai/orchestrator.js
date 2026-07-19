const fs = require('fs');
const path = require('path');
const { sendEvent } = require('./sse');
const { verify } = require('./verify');
const { labelFor } = require('./labels');
const { deliverMeta } = require('./deliver');
const { toUserContent } = require('../services/assets');

// Phase 10 · timeline recorder. Accumulates per-persona (folded) agent activity
// as the pipeline runs — router+clarify+plan → "router", develop+auto-fix →
// "developer", verify → "verifier", qa → "qa" — so it can be persisted on the
// run (C3) in one write at delivery. Derived from events already emitted; not a
// second source of truth.
function createTimeline() {
  const agents = {};
  const get = (a) => (agents[a] || (agents[a] = { durationMs: 0, steps: [] }));
  return {
    record(agent, durationMs, steps) {
      const e = get(agent);
      e.durationMs += Math.max(0, Math.round(durationMs || 0));
      for (const s of steps || []) if (s) e.steps.push(s);
    },
    toArray() {
      // Stable persona order; only agents that actually ran appear.
      return ['router', 'developer', 'verifier', 'qa']
        .filter((a) => agents[a])
        .map((a) => ({ agent: a, durationMs: agents[a].durationMs, steps: agents[a].steps }));
    },
  };
}

const stages = {
  router: require('./stages/router'),
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

// Track B — escape hatches on a clarify/redirect (never on decline). The
// general "best guess" and the page-specific "main section" variants; matched
// verbatim on resume, so they're shared with the controller.
const BUILD_ANYWAY = 'Build your best guess anyway';
const BUILD_MAIN_ANYWAY = 'Build the main section anyway';

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

  const tl = createTimeline();

  // Compute + emit the deliver metadata once, at a code-bearing return. Reads
  // the current plan/qaVerdict via closure. Best-effort — never throws into the
  // pipeline (a metadata slip must not fail a delivered build).
  function finalizeDelivery(code, verifyStatus) {
    try {
      const meta = deliverMeta({ code, plan, request, verifyStatus, qaVerdict });
      sendEvent(res, {
        runId,
        stage: 'deliver',
        status: 'done',
        payload: { sizeKb: meta.sizeKb, a11y: meta.a11y, gates: meta.gates },
      });
      return { timeline: tl.toArray(), deliverMeta: meta };
    } catch {
      return { timeline: tl.toArray() };
    }
  }

  if (roundsUsed === 0 && !ctx.resumed) {
    const lastUser = messages[messages.length - 1];
    const hasPriorCode = messages.some(
      (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('```tsx')
    );
    // The screenshot informs the tier (a full page routes multi/full).
    const tRouter = Date.now();
    const routed = await stages.router.run({ runId, res, prompt: lastUser.content, hasPriorCode, image });
    tier = routed.tier;
    tl.record('router', Date.now() - tRouter, [`Routed to the ${tier} tier`]);

    // Track A/B — non-build outcomes short-circuit the pipeline. Never on a
    // follow-up edit to existing code: an edit is always a build against the
    // component already in the chat.
    if (routed.outcome !== 'build' && !hasPriorCode) {
      // decline — a firm in-chat refusal turn. No build, no options, no escape.
      if (routed.outcome === 'decline') {
        sendEvent(res, {
          runId,
          stage: 'router',
          status: 'done',
          payload: { tier, outcome: 'decline', message: routed.message },
        });
        tl.record('router', 0, ['Declined — outside policy']);
        return { status: 'declined', message: routed.message, tier, roundsUsed, attempts };
      }

      // clarify / redirect — one question via the needs_input path. The Router
      // wrote `message`; the tappable choices are its options (or detected
      // components for a page), plus a "build anyway" escape.
      const picks = routed.options.length ? routed.options : routed.detectedComponents;
      const escape = routed.reason === 'page' ? BUILD_MAIN_ANYWAY : BUILD_ANYWAY;
      const questions = [{ question: routed.message, options: [...picks, escape] }];
      const reason = routed.reason || routed.outcome;
      sendEvent(res, {
        runId,
        stage: 'clarify',
        status: 'needs_input',
        payload: { questions, reason },
      });
      tl.record('router', 0, [
        routed.outcome === 'redirect' ? 'Redirected — offered an in-scope path' : 'Asked one question',
      ]);
      return {
        status: 'needs_input',
        reason,
        questions,
        assumptions: '',
        tier,
        plan: null,
        roundsUsed,
        attempts,
      };
    }
  }

  if (roundsUsed === 0 && (tier === 'multi' || tier === 'full')) {
    const lastUser = messages[messages.length - 1];
    const tPlan = Date.now();
    plan = await stages.plan.run({ runId, res, messages, image });
    tl.record('router', Date.now() - tPlan, ['Planned the architecture']);
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
    const tDevelop = Date.now();
    const { text, stopReason, substeps } = await stages.develop.run({
      ...ctx,
      tier,
      messages,
      maxTokens,
      roundsUsed,
    });
    tl.record(
      'developer',
      Date.now() - tDevelop,
      roundsUsed === 0 ? substeps || [] : [`Applied fix round ${roundsUsed}`]
    );

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

    let code = extractCode(text);

    if (!code) {
      // Prose answer - nothing for the gates to check, so no deliver metadata.
      return {
        text,
        code: null,
        verifyStatus: null,
        errors: [],
        roundsUsed,
        attempts,
        tier,
        plan,
        truncationRetried,
        timeline: tl.toArray(),
      };
    }

    sendEvent(res, {
      runId,
      stage: 'verify',
      status: 'start',
      payload: { round: roundsUsed, label: labelFor('verify') },
    });
    const tVerify = Date.now();
    const result = await verify(code);
    // The icon gate may have self-healed an unresolved name; deliver the fix.
    if (result.repairedCode) code = result.repairedCode;
    // Stream each gate check as a plain-English substep as it resolves.
    for (const check of result.checks || []) {
      sendEvent(res, {
        runId,
        stage: 'verify',
        status: 'substep',
        payload: { text: check.text, ok: check.ok },
      });
    }
    tl.record('verifier', Date.now() - tVerify, (result.checks || []).map((c) => c.text));
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
        sendEvent(res, {
          runId,
          stage: 'qa',
          status: 'start',
          payload: { label: labelFor('qa') },
        });
        const tQa = Date.now();
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
            tl.record('qa', Date.now() - tQa, [
              `Flagged ${actionable.length} issue${actionable.length === 1 ? '' : 's'} — delivering with warnings`,
            ]);
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
            tl.record('qa', Date.now() - tQa, [
              `Sent ${actionable.length} issue${actionable.length === 1 ? '' : 's'} back to the developer`,
            ]);
            messages = [
              ...messages,
              { role: 'assistant', content: text },
              { role: 'user', content: buildQaFixMessage(actionable) },
            ];
            continue;
          }
        } else {
          sendEvent(res, { runId, stage: 'qa', status: 'done', payload: { pass: true, fixed: qaFixed } });
          tl.record(
            'qa',
            Date.now() - tQa,
            qaFixed ? ['Re-checked after fixes — looks good'] : ['No blocking issues', 'a11y AA passed']
          );
          qaVerdict = qaFixed ? 'fixed' : 'looks_good';
        }
      }

      const verifyStatus = roundsUsed > 0 ? 'passed_after_fix' : 'passed';
      return {
        text,
        code,
        verifyStatus,
        errors: [],
        roundsUsed,
        attempts,
        tier,
        plan,
        truncationRetried,
        qaVerdict,
        qaFindings,
        ...finalizeDelivery(code, verifyStatus),
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
        ...finalizeDelivery(code, 'delivered_with_warnings'),
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

module.exports = {
  stages,
  runPipeline,
  buildFixMessage,
  extractCode,
  MAX_FIX_ROUNDS,
  BUILD_ANYWAY,
  BUILD_MAIN_ANYWAY,
};
