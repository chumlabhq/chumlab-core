const { lint } = require('./lint');
const { typecheck } = require('./typecheck');
const { checkIcons, repairIcons } = require('./icons');
const { staticResponsiveCheck } = require('./checks/responsive');
const { checkSafety } = require('./checks/safety');

// Cheapest first: a lint failure already forces a regeneration, so the
// typecheck is skipped. The orchestrator calls this after Develop. Async because
// the icon gate self-heals an unresolved name via the Iconify resolver before
// failing (its only network touch).
async function verify(code) {
  // `checks` are the plain-English lines the agent panel streams as verify
  // substeps (Phase 10, A1) — one per gate as it runs, each with `ok`.
  const checks = [];

  const lintResult = lint(code);

  // The icon gate rides in the same "no banned APIs/imports" line: no inline
  // <svg>, no raw icon-library import, every prefix:name resolves. If the only
  // problem is unresolved names, try one resolver-backed repair before failing
  // and hand the fixed code back so it's what gets typechecked and delivered.
  let icons = checkIcons(code);
  let repaired = null;
  if (!icons.ok && icons.repairable) {
    const fixed = await repairIcons(code);
    if (fixed !== code) {
      const recheck = checkIcons(fixed);
      if (recheck.ok) {
        repaired = fixed;
        icons = recheck;
      }
    }
  }
  const effectiveCode = repaired || code;

  const firstOk = lintResult.ok && icons.ok;
  checks.push({ text: 'No banned APIs, imports, or inline styles', ok: firstOk });
  if (!firstOk) {
    return {
      ok: false,
      errors: [...lintResult.errors, ...icons.errors],
      checks,
      ...(repaired ? { repairedCode: repaired } : {}),
    };
  }

  const typeResult = typecheck(effectiveCode);
  checks.push({
    text: typeResult.unavailable
      ? 'Type-checks against @chumlab/ui (skipped — types unavailable)'
      : 'Type-checks against @chumlab/ui',
    ok: typeResult.ok,
  });

  // Responsive gate — static layer. Hard pixel widths that can't fit mobile
  // fail here (blocking); the live 360/1024 render check is the client-side
  // source of truth and reports overflow back through the render-fix loop.
  const respFailures = staticResponsiveCheck(effectiveCode);
  const respOk = respFailures.length === 0;
  checks.push({ text: 'Mobile-responsive (no fixed pixel widths)', ok: respOk });

  // Content-safety gate (Track C) — blocking backstop to the Router's intent
  // screen. Hate/harassment content or brand-impersonation phishing fails here.
  const safetyFailures = checkSafety(effectiveCode);
  const safetyOk = safetyFailures.length === 0;
  checks.push({ text: 'Content policy', ok: safetyOk });

  const result = {
    ok: typeResult.ok && respOk && safetyOk,
    errors: [
      ...typeResult.errors,
      ...respFailures.map((message) => ({ kind: 'responsive', message })),
      ...safetyFailures.map((message) => ({ kind: 'safety', message })),
    ],
    checks,
    ...(repaired ? { repairedCode: repaired } : {}),
  };
  if (typeResult.unavailable) result.typecheckUnavailable = true;
  return result;
}

module.exports = { verify };
