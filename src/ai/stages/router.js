const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../anthropic');
const { sendEvent } = require('../sse');

const TIERS = ['trivial', 'single', 'multi', 'full'];
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'router.txt');

let cachedPrompt = null;

function routerPrompt() {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
  return cachedPrompt;
}

// Cheap classification that runs on every request: small model, temperature
// 0, a handful of output tokens. Any failure falls back to `single` so
// routing can never block a generation.
async function run(ctx) {
  const { runId, res, prompt, hasPriorCode } = ctx;
  sendEvent(res, { runId, stage: 'router', status: 'start', payload: {} });

  let tier = 'single';
  try {
    const reply = await sendMessage({
      stage: 'router',
      model: process.env.ANTHROPIC_ROUTER_MODEL || 'claude-haiku-4-5',
      system: routerPrompt(),
      maxTokens: 8,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `${hasPriorCode ? 'The conversation already contains generated code.\n' : ''}Request: ${prompt}`,
        },
      ],
    });
    const word = reply.trim().toLowerCase().match(/[a-z]+/);
    if (word && TIERS.includes(word[0])) tier = word[0];
  } catch {
    // default tier carries the request through
  }

  sendEvent(res, { runId, stage: 'router', status: 'done', payload: { tier } });
  return tier;
}

module.exports = { run, TIERS };
