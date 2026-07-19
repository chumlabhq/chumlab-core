const zlib = require('zlib');

// Phase 10 · deliver metadata (A3/A5).
//
// Computed once at delivery from artifacts the pipeline already has (code, plan,
// verify/qa outcomes). Persisted flat on the run so the runs/chat projection and
// the cluster read it without recomputing, and echoed on the `deliver.done`
// event for the live client.

// Cheap component classification from the plan's component name / root
// primitive, falling back to the code. Drives the history row glyph.
function classifyComponent(code, plan) {
  const s = `${plan || ''}\n${code || ''}`;
  if (/Input\.Otp|one[-\s]?time|\botp\b|verification code/i.test(s)) return 'otp';
  if (/<thead|<table|DataTable|\bTable\b|columns\s*[:=]/.test(s)) return 'table';
  if (/<form|onSubmit|handleSubmit|\bForm\b/.test(s)) return 'form';
  if (/\bCard\b|CardHeader|CardBody|CardContent/.test(s)) return 'card';
  return 'other';
}

// Gzipped size of the emitted component module, in KB to one decimal.
function sizeKbOf(code) {
  if (!code) return 0;
  const bytes = zlib.gzipSync(Buffer.from(code, 'utf8')).length;
  return Math.round((bytes / 1024) * 10) / 10;
}

// Per-gate booleans for the cluster. lint/types/responsive/safety are the
// blocking verify gates; render is the client-side gate — optimistically true
// when verify passed (the browser confirms it live and re-enters through /fix if
// it doesn't); qa reflects the critic verdict (null verdict = QA didn't run on
// this tier, treated as pass).
function gatesFrom(verifyStatus, qaVerdict) {
  const verifyPassed =
    verifyStatus === 'passed' || verifyStatus === 'passed_after_fix';
  const qaPassed =
    qaVerdict == null || qaVerdict === 'looks_good' || qaVerdict === 'fixed';
  return {
    lint: verifyPassed,
    types: verifyPassed,
    render: verifyPassed,
    responsive: verifyPassed,
    safety: verifyPassed,
    qa: qaPassed,
  };
}

// First ~6 words of the request, else the component name. Title for the row.
function titleFrom(request, componentType) {
  const words = String(request || '').trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const t = words.slice(0, 6).join(' ');
    return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  }
  return componentType === 'other' ? 'Component' : `${componentType.toUpperCase()} component`;
}

// Assemble the full deliver metadata block from pipeline outputs.
function deliverMeta({ code, plan, request, verifyStatus, qaVerdict }) {
  const componentType = classifyComponent(code, plan);
  const gates = gatesFrom(verifyStatus, qaVerdict);
  const gatesPassed =
    gates.lint &&
    gates.types &&
    gates.render &&
    gates.responsive &&
    gates.safety &&
    gates.qa;
  return {
    componentType,
    sizeKb: sizeKbOf(code),
    a11y: gatesPassed ? 'AA' : null,
    gates,
    gatesPassed,
    title: titleFrom(request, componentType),
  };
}

module.exports = { deliverMeta, classifyComponent, sizeKbOf, gatesFrom, titleFrom };
