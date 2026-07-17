const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../anthropic');
const { sendEvent } = require('../sse');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'clarify.txt');

let cachedPrompt = null;

function clarifyPrompt() {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
  return cachedPrompt;
}

function parseDecision(reply) {
  try {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start === -1 || end === -1) return { questions: [], assumptions: '' };
    const obj = JSON.parse(reply.slice(start, end + 1));
    const questions = (Array.isArray(obj.questions) ? obj.questions : [])
      .filter((q) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
      .slice(0, 3)
      .map((q) => ({ question: q.question.trim(), options: q.options.slice(0, 4).map(String) }));
    return { questions, assumptions: typeof obj.assumptions === 'string' ? obj.assumptions : '' };
  } catch {
    return { questions: [], assumptions: '' };
  }
}

// Cheap ambiguity triage for multi/full requests, run before Plan. Standalone
// system prompt (not the full component reference) since the decision is about
// the request, not the library. Any failure passes through silently - clarify
// must never block a build.
async function run(ctx) {
  const { runId, res, prompt } = ctx;
  sendEvent(res, { runId, stage: 'clarify', status: 'start', payload: {} });

  let decision = { questions: [], assumptions: '' };
  try {
    const reply = await sendMessage({
      system: clarifyPrompt(),
      maxTokens: 512,
      messages: [{ role: 'user', content: `Request: ${prompt}` }],
    });
    decision = parseDecision(reply);
  } catch {
    // pass through
  }

  if (decision.questions.length) {
    sendEvent(res, {
      runId,
      stage: 'clarify',
      status: 'needs_input',
      payload: { questions: decision.questions, assumptions: decision.assumptions },
    });
  } else {
    sendEvent(res, { runId, stage: 'clarify', status: 'done', payload: { assumptions: decision.assumptions } });
  }
  return decision;
}

module.exports = { run };
