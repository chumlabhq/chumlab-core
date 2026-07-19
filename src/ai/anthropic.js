let client = null;

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 8192;

// A hung Anthropic call would otherwise hold the SSE response open forever. Cap
// every call: sendMessage gets a hard deadline; streamMessage gets an idle
// deadline (re-armed on each token) so a long-but-progressing stream isn't
// killed, only a stalled one. On timeout we abort the request and reject with a
// clean error, which surfaces through the normal stage-error path.
const LLM_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS, 10) || 90000;

function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Race a factory (given an AbortSignal) against a hard deadline. On timeout the
// signal is aborted (cancelling the underlying request) and the race rejects
// with a clean, labeled error rather than hanging.
async function withTimeout(factory, ms, label) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([factory(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// One line per model call so every generation's cost/cache behavior is
// visible in the logs. cache_read > 0 means the cached system prefix hit.
function logUsage(stage, usage) {
  if (!usage) return;
  console.log(
    `[chumlab-be] usage stage=${stage || 'unknown'} input=${usage.input_tokens || 0} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} ` +
      `cache_creation=${usage.cache_creation_input_tokens || 0} ` +
      `output=${usage.output_tokens || 0}`
  );
}

async function sendMessage({ model, system, messages, maxTokens, temperature, stage }) {
  const response = await withTimeout(
    (signal) =>
      getClient().messages.create(
        {
          model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
          max_tokens: maxTokens || 1024,
          ...(temperature != null ? { temperature } : {}),
          ...(system ? { system } : {}),
          messages,
        },
        { signal }
      ),
    LLM_TIMEOUT_MS,
    `Anthropic ${stage || 'request'}`
  );
  logUsage(stage, response.usage);
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function streamMessage({ system, messages, maxTokens, onDelta, stage }) {
  const controller = new AbortController();
  let timer;
  let rejectIdle;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      rejectIdle(new Error(`Anthropic ${stage || 'stream'} stalled (no output for ${LLM_TIMEOUT_MS}ms)`));
    }, LLM_TIMEOUT_MS);
  };
  const idle = new Promise((_resolve, reject) => {
    rejectIdle = reject;
  });
  arm();
  try {
    const stream = getClient().messages.stream(
      {
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
        // The system prompt carries the full 100k+ token component reference -
        // cache it server-side so repeat generations skip re-ingesting it.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      },
      { signal: controller.signal }
    );
    stream.on('text', (chunk) => {
      arm();
      if (onDelta) onDelta(chunk);
    });
    const final = await Promise.race([stream.finalMessage(), idle]);
    logUsage(stage, final.usage);
    const text = final.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    // stop_reason 'max_tokens' means the output was truncated mid-file - the
    // orchestrator retries or fails instead of verifying garbage.
    return { text, stopReason: final.stop_reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getClient, sendMessage, streamMessage, withTimeout };
