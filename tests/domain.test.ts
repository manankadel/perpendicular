import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackReply, buildOnboardingArtifacts, createInitialState, findRelevantDocuments, scoreRun } from "../src/lib/domain";

test("seed workspace has the core employee -> knowledge -> run loop", () => {
  const state = createInitialState();
  assert.equal(state.workspace.plan, "Open Source");
  assert.ok(state.employees.length >= 3);
  assert.ok(state.documents.length >= 3);
  assert.ok(state.runs.every((run) => run.trace.length >= 3));
});

test("retrieval returns scoped documents that share query terms", () => {
  const state = createInitialState();
  const matches = findRelevantDocuments(state.documents, "deliverability follow-through suppression");
  assert.deepEqual(matches.map((document) => document.id), ["doc-gtm"]);
});

test("fallback replies disclose source context and next action", () => {
  const state = createInitialState();
  const result = buildFallbackReply(state.employees[0], "What should we do about a stalled pipeline lead?", state.documents);
  assert.match(result.content, /Next action:/);
  assert.ok(result.citations.length > 0);
});

test("run scoring rewards evidence and ownership without exceeding the rubric", () => {
  const score = scoreRun("Write a prioritized pipeline report", "Evidence says Meridian is stalled. Next action: Manan owns the rescue.");
  assert.ok(score >= 80);
  assert.ok(score <= 98);
});

test("onboarding builds one real source and one scoped operator", () => {
  const result = buildOnboardingArtifacts({
    companyId: "blueblood-studio",
    companyName: "Blueblood Studio",
    goal: "content",
    discovery: {
      url: "https://example.com",
      title: "Blueblood Studio",
      description: "A design and development studio.",
      text: "Blueblood Studio builds digital products for ambitious teams. The studio focuses on design, development, and reliable delivery.",
    },
  });
  assert.equal(result.employee.department, "Content");
  assert.equal(result.document.source, "url");
  assert.deepEqual(result.document.employeeIds, [result.employee.id]);
  assert.match(result.employee.systemPrompt, /Blueblood Studio/);
  assert.match(result.task, /content/i);
});
