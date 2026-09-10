import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackReply, buildOnboardingArtifacts, createInitialState, findRelevantDocuments, scoreRun, ticketSlaMinutes } from "../src/lib/domain";

test("seed workspace has the core employee -> knowledge -> run loop", () => {
  const state = createInitialState();
  assert.equal(state.workspace.plan, "Open Source");
  assert.ok(state.employees.length >= 3);
  assert.ok(state.documents.length >= 3);
  assert.ok(state.runs.every((run) => run.trace.length >= 3));
});

test("development seed follows the configured credit budgets", () => {
  const previousAi = process.env.INITIAL_AI_CREDITS;
  const previousData = process.env.INITIAL_DATA_CREDITS;
  process.env.INITIAL_AI_CREDITS = "321";
  process.env.INITIAL_DATA_CREDITS = "654";
  const state = createInitialState("credit-test");
  assert.deepEqual(state.workspace.aiCredits, { remaining: 321, limit: 321 });
  assert.deepEqual(state.workspace.dataCredits, { remaining: 654, purchased: 654 });
  if (previousAi === undefined) delete process.env.INITIAL_AI_CREDITS;
  else process.env.INITIAL_AI_CREDITS = previousAi;
  if (previousData === undefined) delete process.env.INITIAL_DATA_CREDITS;
  else process.env.INITIAL_DATA_CREDITS = previousData;
});

test("production workspaces start empty instead of receiving demo records", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  environment.NODE_ENV = "production";
  try {
    const state = createInitialState("production-workspace");
    assert.equal(state.workspace.onboarding.status, "not_started");
    assert.equal(state.employees.length, 0);
    assert.equal(state.documents.length, 0);
    assert.equal(state.runs.length, 0);
    assert.equal(state.lists.length, 0);
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
  }
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

test("ticket SLA windows follow the operational priority contract", () => {
  assert.equal(ticketSlaMinutes("urgent"), 30);
  assert.equal(ticketSlaMinutes("high"), 120);
  assert.equal(ticketSlaMinutes("normal"), 480);
  assert.equal(ticketSlaMinutes("low"), 1440);
});
