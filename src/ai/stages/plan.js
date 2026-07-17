const fs = require('fs');
const path = require('path');
const { streamMessage } = require('../anthropic');
const { sendEvent } = require('../sse');
const { developPrompt } = require('./develop');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'plan.txt');

let cachedPrompt = null;

function planPrompt() {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
  return cachedPrompt;
}

// Streams a structured build plan for multi/full requests. Reuses the cached
// develop system prompt so the plan knows the real component inventory and
// the cache stays warm; the plan-only instruction rides the user turn.
async function run(ctx) {
  const { runId, res, messages } = ctx;
  sendEvent(res, { runId, stage: 'plan', status: 'start', payload: {} });

  const lastUser = messages[messages.length - 1];
  const { text } = await streamMessage({
    stage: 'plan',
    system: developPrompt(),
    maxTokens: 1024,
    messages: [
      ...messages.slice(0, -1),
      { role: 'user', content: `${lastUser.content}\n\n${planPrompt()}` },
    ],
    onDelta: (chunk) =>
      sendEvent(res, { runId, stage: 'plan', status: 'delta', payload: { text: chunk } }),
  });

  sendEvent(res, { runId, stage: 'plan', status: 'done', payload: {} });
  return text;
}

module.exports = { run };
