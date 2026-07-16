const fs = require('fs');
const path = require('path');
const { streamMessage } = require('../anthropic');
const { sendEvent } = require('../sse');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'develop.txt');

let cachedPrompt = null;

function developPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const text = fs.readFileSync(PROMPT_PATH, 'utf8');
  if (!text.trim() || text.includes('[[ llms-full.txt ]]')) {
    throw new Error(
      'ai/prompts/develop.txt is not assembled - build it from CHUMLAB_CODEGEN_SYSTEM_PROMPT.md with llms-full.txt inlined'
    );
  }
  cachedPrompt = text;
  return cachedPrompt;
}

async function run(ctx) {
  const { runId, chatId, res, messages } = ctx;
  sendEvent(res, { runId, stage: 'develop', status: 'start', payload: { chatId } });
  const text = await streamMessage({
    system: developPrompt(),
    messages,
    onDelta: (chunk) =>
      sendEvent(res, { runId, stage: 'develop', status: 'delta', payload: { text: chunk } }),
  });
  sendEvent(res, { runId, stage: 'develop', status: 'done', payload: { chatId } });
  return text;
}

module.exports = { run };
