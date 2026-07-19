const fs = require('fs');
const path = require('path');
const { streamMessage } = require('../anthropic');
const { sendEvent } = require('../sse');
const { labelFor } = require('../labels');

// Templated develop sub-steps (A1 fallback). The spec prefers the plan stage to
// name what's being composed; absent that structured output we stream these
// generic-but-plain lines so the Developer row always has visible progress.
const DEVELOP_SUBSTEPS = [
  'Composing with @chumlab/ui primitives',
  'Wiring interactions and state',
];

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
  const { runId, chatId, res, messages, maxTokens } = ctx;
  sendEvent(res, {
    runId,
    stage: 'develop',
    status: 'start',
    payload: { chatId, label: labelFor('develop') },
  });
  // Best-effort narration — only on the first build turn (fix rounds skip it so
  // the panel doesn't repeat "composing…" on every retry).
  const substeps = ctx.roundsUsed ? [] : DEVELOP_SUBSTEPS;
  for (const text of substeps) {
    sendEvent(res, { runId, stage: 'develop', status: 'substep', payload: { text, ok: true } });
  }
  const { text, stopReason } = await streamMessage({
    stage: 'develop',
    system: developPrompt(),
    messages,
    maxTokens,
    onDelta: (chunk) =>
      sendEvent(res, { runId, stage: 'develop', status: 'delta', payload: { text: chunk } }),
  });
  sendEvent(res, { runId, stage: 'develop', status: 'done', payload: { chatId } });
  return { text, stopReason, substeps };
}

module.exports = { run, developPrompt };
