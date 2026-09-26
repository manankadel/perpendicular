import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("headless API exposes SDK-compatible routes and persists through the product contract", () => {
  const openAi = readFileSync(join(root, "src/app/api/v0/chat/completions/route.ts"), "utf8");
  const anthropic = readFileSync(join(root, "src/app/api/v0/messages/route.ts"), "utf8");
  const agents = readFileSync(join(root, "src/app/api/v1/agents/route.ts"), "utf8");
  const implementation = readFileSync(join(root, "src/lib/headless-chat.ts"), "utf8");
  const docs = readFileSync(join(root, "src/app/api/docs/route.ts"), "utf8");
  assert.match(openAi, /v1\/chat\/completions/);
  assert.match(anthropic, /v1\/messages/);
  assert.match(agents, /export async function POST/);
  assert.match(agents, /updateWorkspace/);
  assert.match(implementation, /workspace\.aiCredits\.remaining/);
  assert.match(implementation, /normalizeHeadlessMessages/);
  assert.match(implementation, /candidate\.type === "text"/);
  assert.match(implementation, /recordAuditEvent/);
  assert.match(implementation, /recordUsage/);
  assert.match(docs, /\/api\/v0\/chat\/completions/);
  assert.match(docs, /\/api\/v0\/messages/);
});
