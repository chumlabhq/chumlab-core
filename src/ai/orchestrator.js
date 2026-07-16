const stages = {
  router: require('./stages/router'),
  clarify: require('./stages/clarify'),
  plan: require('./stages/plan'),
  develop: require('./stages/develop'),
  qa: require('./stages/qa'),
};

async function runPipeline({ run, res }) {
  throw new Error('runPipeline is not implemented');
}

module.exports = { stages, runPipeline };
