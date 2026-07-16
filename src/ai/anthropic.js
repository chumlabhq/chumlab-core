let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  // Lazy require: the SDK dependency lands with the develop stage (Phase 3),
  // and nothing else on the API should fail to boot without it.
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

async function streamMessage({ model, system, messages, maxTokens, onDelta }) {
  throw new Error('streamMessage is not implemented');
}

module.exports = { getClient, streamMessage };
