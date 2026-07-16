const stages = {
  router: require('./stages/router'),
  clarify: require('./stages/clarify'),
  plan: require('./stages/plan'),
  develop: require('./stages/develop'),
  qa: require('./stages/qa'),
};

// Single-shot for now: router/plan/verify/qa slot in around develop in later
// phases; the registry above already carries their stubs.
async function runPipeline(ctx) {
  return stages.develop.run(ctx);
}

module.exports = { stages, runPipeline };
