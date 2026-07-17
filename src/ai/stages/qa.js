const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../anthropic');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'qa.txt');

const SEVERITIES = ['high', 'medium', 'low'];

let cachedPrompt = null;

function qaPrompt() {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
  return cachedPrompt;
}

function parseReview(reply) {
  try {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start === -1 || end === -1) return { findings: [] };
    const obj = JSON.parse(reply.slice(start, end + 1));
    const findings = (Array.isArray(obj.findings) ? obj.findings : [])
      .filter((f) => f && typeof f.description === 'string')
      .map((f) => ({
        severity: SEVERITIES.includes(f.severity) ? f.severity : 'medium',
        description: f.description.trim(),
        location: typeof f.location === 'string' ? f.location.trim() : undefined,
      }));
    return { findings };
  } catch {
    return { findings: [] };
  }
}

// Cold PR review in a SEPARATE context from Develop - it gets only the
// request, the plan, and the final code, never the writer's own reasoning.
// Any failure returns no findings so a QA-infra problem never blocks
// delivery (same graceful-degradation posture as the verify gates).
async function run({ request, plan, code }) {
  try {
    const reply = await sendMessage({
      stage: 'qa',
      system: qaPrompt(),
      maxTokens: 1500,
      messages: [
        {
          role: 'user',
          content:
            `## Original request\n${request}\n\n` +
            `## Build plan\n${plan || '(no plan - smaller build)'}\n\n` +
            `## Final code\n\`\`\`tsx\n${code}\n\`\`\``,
        },
      ],
    });
    return parseReview(reply);
  } catch {
    return { findings: [] };
  }
}

module.exports = { run };
