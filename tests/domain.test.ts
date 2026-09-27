import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackReply, buildOnboardingArtifacts, createInitialState, findRelevantDocuments, normalizeWorkspaceState, recordEmployeeScore, scoreRun, ticketSlaMinutes, type WorkspaceState } from "../src/lib/domain";

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
    assert.equal(state.schedules.length, 0);
    assert.equal(state.people.length, 0);
    assert.equal(state.campaigns.length, 0);
    assert.equal(state.inboundAgents.length, 0);
    assert.equal(state.apps.length, 0);
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

test("retrieval ignores generic question words", () => {
  const state = createInitialState();
  assert.deepEqual(findRelevantDocuments(state.documents, "what is this platform"), []);
});

test("fallback replies disclose source context and next action", () => {
  const state = createInitialState();
  const result = buildFallbackReply(state.employees[0], "What should we do about a stalled pipeline lead?", state.documents);
  assert.match(result.content, /Next action:/);
  assert.ok(result.citations.length > 0);
});

test("fallback explains Perpendicular without borrowing another product identity", () => {
  const state = createInitialState();
  const result = buildFallbackReply(state.employees[0], "What is this platform?", state.documents);
  assert.match(result.content, /Perpendicular is an open-source work system/);
  assert.doesNotMatch(result.content, /Vibecoding|Parallel AI/i);
});

test("run scoring rewards evidence and ownership without exceeding the rubric", () => {
  const score = scoreRun("Write a prioritized pipeline report", "Evidence says Meridian is stalled. Next action: Manan owns the rescue.");
  assert.ok(score >= 80);
  assert.ok(score <= 98);
});

test("the first employee run adopts its real score instead of averaging against zero", () => {
  const employee = { score: 0, scoreTrend: [0] };
  recordEmployeeScore(employee, 80);
  assert.equal(employee.score, 80);
  assert.deepEqual(employee.scoreTrend, [80]);
  recordEmployeeScore(employee, 90);
  assert.equal(employee.score, 84);
  assert.deepEqual(employee.scoreTrend, [80, 90]);
});

test("legacy first-run score state is normalized to the persisted run score", () => {
  const state = createInitialState("legacy-score");
  state.employees[0].score = 28;
  state.employees[0].scoreTrend = [0, 80];
  const normalized = normalizeWorkspaceState(state, "legacy-score");
  assert.equal(normalized.employees[0].score, 80);
  assert.deepEqual(normalized.employees[0].scoreTrend, [80]);
});

test("onboarding builds a source, an operator pod, and executable work", () => {
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
  assert.equal(result.employees.length, 4);
  assert.equal(result.missions.length, 4);
  assert.equal(result.content.length, 3);
  assert.equal(result.sequence.status, "draft");
  assert.equal(result.sequence.steps.length, 5);
  assert.equal(result.list.rows.length, 0);
  assert.equal(result.leadSource.type, "public");
  assert.equal(result.leadSource.listId, result.list.id);
  assert.equal(result.inboundAgent.status, "live");
  assert.equal(result.site.status, "published");
  assert.equal(result.site.agentId, result.inboundAgent.id);
  assert.ok(result.sequence.steps.every((step) => step.channel === "Email" || step.channel === "Task"));
  assert.ok(result.employees.every((employee) => employee.tools && employee.tools.length > 0));
  assert.ok(result.missions.every((mission) => mission.sourceDocumentIds.includes(result.document.id)));
  assert.equal(result.document.source, "url");
  assert.deepEqual(result.document.employeeIds, [result.employee.id]);
  assert.match(result.employee.systemPrompt, /Blueblood Studio/);
  assert.match(result.task, /content/i);
});

test("seed workspace exposes the durable operating surfaces", () => {
  const state = createInitialState();
  assert.ok(state.profile.description);
  assert.ok(state.missions.some((mission) => mission.status === "needs_review"));
  assert.ok(state.content.some((item) => item.status === "review"));
  assert.ok(state.playbooks.every((playbook) => playbook.installedAt));
});

test("legacy workspaces receive the product-native collection defaults", () => {
  const legacy = JSON.parse(JSON.stringify(createInitialState("legacy-native"))) as WorkspaceState;
  delete (legacy as Partial<WorkspaceState>).members;
  delete (legacy as Partial<WorkspaceState>).schedules;
  delete (legacy as Partial<WorkspaceState>).people;
  delete (legacy as Partial<WorkspaceState>).leadSources;
  delete (legacy as Partial<WorkspaceState>).campaigns;
  delete (legacy as Partial<WorkspaceState>).keywordMonitors;
  delete (legacy as Partial<WorkspaceState>).inboundAgents;
  delete (legacy as Partial<WorkspaceState>).sites;
  delete (legacy as Partial<WorkspaceState>).apps;
  legacy.workspace.onboarding.discoveredAt = null;
  legacy.workspace.onboarding.status = "not_started";
  const migrated = normalizeWorkspaceState(legacy, "legacy-native");
  assert.deepEqual(migrated.members, []);
  assert.deepEqual(migrated.schedules, []);
  assert.deepEqual(migrated.people, []);
  assert.deepEqual(migrated.leadSources, []);
  assert.deepEqual(migrated.campaigns, []);
  assert.deepEqual(migrated.keywordMonitors, []);
  assert.deepEqual(migrated.inboundAgents, []);
  assert.deepEqual(migrated.sites, []);
  assert.deepEqual(migrated.apps, []);
});

test("legacy one-operator workspaces receive a deterministic work queue", () => {
  const legacy = JSON.parse(JSON.stringify(createInitialState())) as WorkspaceState;
  delete (legacy as Partial<WorkspaceState>).profile;
  delete (legacy as Partial<WorkspaceState>).missions;
  delete (legacy as Partial<WorkspaceState>).content;
  delete (legacy as Partial<WorkspaceState>).playbooks;
  delete (legacy.workspace.onboarding as Partial<WorkspaceState["workspace"]["onboarding"]>).employeeIds;
  delete (legacy.workspace.onboarding as Partial<WorkspaceState["workspace"]["onboarding"]>).missionIds;
  delete (legacy.workspace.onboarding as Partial<WorkspaceState["workspace"]["onboarding"]>).contentIds;
  const migrated = normalizeWorkspaceState(legacy, "legacy-company");
  assert.equal(migrated.missions.length, 1);
  assert.equal(migrated.content.length, 1);
  assert.equal(migrated.missions[0].id, `mission-legacy-${legacy.employees[0].id}`);
  assert.deepEqual(migrated.workspace.onboarding.employeeIds, [legacy.workspace.onboarding.employeeId]);
});

test("discovered workspaces receive a deterministic starter sequence during migration", () => {
  const legacy = JSON.parse(JSON.stringify(createInitialState("discovered-company"))) as WorkspaceState;
  legacy.sequences = [];
  const migrated = normalizeWorkspaceState(legacy, "discovered-company");
  assert.equal(migrated.sequences.length, 1);
  assert.equal(migrated.sequences[0].id, "seq-onboarding-discovered-company");
  assert.equal(migrated.sequences[0].steps.length, 5);
  assert.equal(migrated.sequences[0].status, "draft");
});

test("discovered workspaces receive additive lead and inbound launch surfaces", () => {
  const state = createInitialState("discovered-surfaces");
  state.workspace.onboarding.discoveredAt = new Date().toISOString();
  state.workspace.onboarding.employeeId = state.employees[0]?.id || null;
  state.documents = state.documents.slice(0, 1);
  state.lists = [];
  state.inboundAgents = [];
  state.sites = [];
  const migrated = normalizeWorkspaceState(state, "discovered-surfaces");
  assert.equal(migrated.lists.length, 1);
  assert.equal(migrated.inboundAgents[0]?.status, "live");
  assert.equal(migrated.sites[0]?.status, "published");
  assert.equal(migrated.sites[0]?.agentId, migrated.inboundAgents[0]?.id);
});

test("ticket SLA windows follow the operational priority contract", () => {
  assert.equal(ticketSlaMinutes("urgent"), 30);
  assert.equal(ticketSlaMinutes("high"), 120);
  assert.equal(ticketSlaMinutes("normal"), 480);
  assert.equal(ticketSlaMinutes("low"), 1440);
});
