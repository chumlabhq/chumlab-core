// Assembles src/ai/prompts/develop.txt: the system-prompt skeleton from
// CHUMLAB_CODEGEN_SYSTEM_PROMPT.md with the frontend's generated
// llms-full.txt inlined at the [[ llms-full.txt ]] marker.
//
// develop.txt is a BUILD PRODUCT - when a component's .ai.md changes, the
// flow is: chumlab-fe `npm run build:llms`, then here `npm run build:prompt`.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(repoRoot, "..");

const skeletonPath =
  process.env.CODEGEN_PROMPT_PATH || path.join(workspaceRoot, "CHUMLAB_CODEGEN_SYSTEM_PROMPT.md");
const uiDir = process.env.CHUMLAB_UI_DIR || path.join(workspaceRoot, "chumlab-fe");
const outPath = path.join(repoRoot, "src", "ai", "prompts", "develop.txt");

const skeleton = readFileSync(skeletonPath, "utf8");
const llmsFull = readFileSync(path.join(uiDir, "llms-full.txt"), "utf8");

const start = skeleton.indexOf("You are Chumlab AI");
const end = skeleton.indexOf("## Implementation notes");
if (start === -1 || end === -1) {
  console.error(`Prompt markers not found in ${skeletonPath}`);
  process.exit(1);
}

let prompt = skeleton
  .slice(start, end)
  .replace(/## APPEND BELOW THIS LINE[\s\S]*?\[\[ llms-full\.txt \]\]/, llmsFull.trim());
prompt = prompt.replace(/\n---\s*$/g, "").trimEnd() + "\n";

if (prompt.includes("[[ llms-full.txt ]]")) {
  console.error("[[ llms-full.txt ]] marker still present after assembly");
  process.exit(1);
}

writeFileSync(outPath, prompt);
const bytes = Buffer.byteLength(prompt);
console.log(
  `develop.txt: ${(bytes / 1024).toFixed(0)} KB, ~${Math.round(bytes / 4 / 1000)}k-${Math.round(bytes / 3.5 / 1000)}k tokens`
);
