import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicResponse } from "@/lib/headless-http";

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

test("Anthropic-compatible streaming returns valid message events", async () => {
  const response = anthropicResponse({
    employeeId: "emp-test",
    employeeName: "Test operator",
    content: "Grounded answer with a next action.",
    citations: ["Company source"],
    provider: "local fallback",
    model: "perpendicular-local",
    timings: { retrievalDurationMs: 1, workerDurationMs: 2 },
  }, new Request("https://perpendicular-api.example/api/v1/messages"), true);
  const body = await response.text();
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.match(body, /event: message_start/);
  assert.match(body, /event: content_block_delta/);
  assert.match(body, /Grounded answer with a next action\./);
  assert.match(body, /event: message_delta/);
  assert.match(body, /event: message_stop/);
});
