let client = null;

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 8192;

function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

async function sendMessage({ model, system, messages, maxTokens, temperature }) {
  const response = await getClient().messages.create({
    model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: maxTokens || 1024,
    ...(temperature != null ? { temperature } : {}),
    ...(system ? { system } : {}),
    messages,
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function streamMessage({ system, messages, maxTokens, onDelta }) {
  const stream = getClient().messages.stream({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    // The system prompt carries the full 100k+ token component reference -
    // cache it server-side so repeat generations skip re-ingesting it.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  if (onDelta) stream.on('text', onDelta);
  const final = await stream.finalMessage();
  const text = final.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  // stop_reason 'max_tokens' means the output was truncated mid-file - the
  // orchestrator retries or fails instead of verifying garbage.
  return { text, stopReason: final.stop_reason };
}

module.exports = { getClient, sendMessage, streamMessage };
