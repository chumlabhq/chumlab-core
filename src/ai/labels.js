// Phase 10 · human-readable stage labels.
//
// Every stage `start` event carries a short, user-facing `label` — the line the
// agent panel shows above the streaming sub-steps. These are the fallback,
// templated labels (A1): best-effort, never allowed to fail a run. They are
// worded from the persona's point of view (see AGENTS map in the phase spec):
// Router plans, Developer writes, Verifier tests edge cases, QA runs the gates.
const STAGE_LABELS = {
  router: 'Understanding your request',
  clarify: 'Checking what needs clarifying',
  plan: 'Planning the build',
  develop: 'Writing the component',
  verify: 'Testing edge cases',
  qa: 'Running the gates',
  deliver: 'Wrapping up',
};

function labelFor(stage) {
  return STAGE_LABELS[stage] || null;
}

module.exports = { STAGE_LABELS, labelFor };
