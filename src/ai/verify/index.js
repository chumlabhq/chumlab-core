const { lint } = require('./lint');
const { typecheck } = require('./typecheck');

// Cheapest first: a lint failure already forces a regeneration, so the
// typecheck is skipped. This is what the Phase 4 orchestrator calls after
// Develop.
function verify(code) {
  const lintResult = lint(code);
  if (!lintResult.ok) {
    return { ok: false, errors: lintResult.errors };
  }

  const typeResult = typecheck(code);
  const result = { ok: typeResult.ok, errors: typeResult.errors };
  if (typeResult.unavailable) result.typecheckUnavailable = true;
  return result;
}

module.exports = { verify };
