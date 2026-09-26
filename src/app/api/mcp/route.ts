import { corsHeadersFor, corsJson } from "@/lib/cors";
import { addActivity, createId, scoreRun, timestamp, type WorkspaceState } from "@/lib/domain";
import { listIntegrationSummaries, recordAuditEvent } from "@/lib/integration-store";
import { generateEmployeeReply } from "@/lib/llm";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { recordUsage } from "@/lib/usage";
import { workspaceStateForClient } from "@/lib/workspace-view";
import { executeWorkspaceApp } from "@/lib/app-runtime";
import { executeWorkspacePlaybook } from "@/lib/playbook-runtime";
import { executeTicketReplyDraft } from "@/lib/ticket-runtime";
import { executeTicketReplySend } from "@/lib/ticket-send-runtime";
import { createWorkspaceDeal, updateWorkspaceDeal } from "@/lib/deal-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tools = [
  { name: "workspace_get", description: "Read the authenticated workspace state.", inputSchema: { type: "object", properties: {} } },
  { name: "employee_chat", description: "Ask a named employee and persist the conversation.", inputSchema: { type: "object", required: ["employeeId", "message"], properties: { employeeId: { type: "string" }, message: { type: "string" } } } },
  { name: "employee_run", description: "Run a task through an employee and persist the scored run.", inputSchema: { type: "object", required: ["employeeId", "task"], properties: { employeeId: { type: "string" }, task: { type: "string" } } } },
  { name: "app_run", description: "Run an active workspace app with operator input and persist the scored result.", inputSchema: { type: "object", required: ["appId"], properties: { appId: { type: "string" }, input: { type: "string" } } } },
  { name: "playbook_run", description: "Run an installed playbook through a live employee and persist the scored mission for review.", inputSchema: { type: "object", required: ["playbookId"], properties: { playbookId: { type: "string" }, employeeId: { type: "string" }, input: { type: "string" } } } },
  { name: "mission_run", description: "Run a persisted mission through its assigned employee and leave the result waiting for review.", inputSchema: { type: "object", required: ["missionId"], properties: { missionId: { type: "string" } } } },
  { name: "mission_approve", description: "Approve a mission result and mark it completed.", inputSchema: { type: "object", required: ["missionId"], properties: { missionId: { type: "string" } } } },
  { name: "content_generate", description: "Generate a grounded content draft and leave it waiting for review.", inputSchema: { type: "object", required: ["contentId"], properties: { contentId: { type: "string" } } } },
  { name: "content_approve", description: "Approve a generated content item.", inputSchema: { type: "object", required: ["contentId"], properties: { contentId: { type: "string" } } } },
  { name: "ticket_reply_draft", description: "Draft a grounded support reply, persist it on the ticket, and leave external sending to a human/provider action.", inputSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" }, employeeId: { type: "string" } } } },
  { name: "ticket_reply_send", description: "Send a previously drafted ticket reply through the connected Gmail mailbox with suppression, daily-limit, and durable idempotency checks.", inputSchema: { type: "object", required: ["ticketId"], properties: { ticketId: { type: "string" }, body: { type: "string" } } } },
  { name: "deal_create", description: "Create a workspace-scoped pipeline opportunity with value, stage, owner, source, and next action.", inputSchema: { type: "object", required: ["name", "company"], properties: { name: { type: "string" }, company: { type: "string" }, amount: { type: "number" }, stage: { type: "string" }, ownerEmployeeId: { type: "string" }, personId: { type: "string" }, source: { type: "string" }, nextAction: { type: "string" }, closeDate: { type: "string" }, notes: { type: "string" } } } },
  { name: "deal_update", description: "Update a pipeline opportunity and append stage history when its stage changes.", inputSchema: { type: "object", required: ["dealId"], properties: { dealId: { type: "string" }, stage: { type: "string" }, stageNote: { type: "string" }, amount: { type: "number" }, ownerEmployeeId: { type: "string" }, nextAction: { type: "string" }, closeDate: { type: "string" }, notes: { type: "string" } } } },
  { name: "integrations_list", description: "List connected integration metadata without secrets.", inputSchema: { type: "object", properties: {} } },
];

function result(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function employeeFrom(state: WorkspaceState, id: string) {
  const employee = state.employees.find((item) => item.id === id);
  if (!employee) throw new Error("Employee not found.");
  return employee;
}

function missionFrom(state: WorkspaceState, id: string) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission) throw new Error("Mission not found.");
  return mission;
}

function contentFrom(state: WorkspaceState, id: string) {
  const item = state.content.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Content item not found.");
  return item;
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  const respond = (body: unknown, init?: ResponseInit) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(rateLimitHeaders(identity.context))) headers.set(name, value);
    return corsJson(body, { ...init, headers }, request);
  };
  const persistedFailure = (id: string | number | null, state: WorkspaceState, message: string) => respond({ jsonrpc: "2.0", id, error: { code: -32001, message, data: { persisted: true, state } } }, { status: 503 });
  let body: { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  try { body = await request.json() as typeof body; } catch { return corsJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } }, { status: 400 }, request); }
  const id = body.id ?? null;
  try {
    if (body.method === "initialize") return respond({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "perpendicular", version: "1.0.0" } } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers: corsHeadersFor(request) });
    if (body.method === "tools/list") return respond({ jsonrpc: "2.0", id, result: { tools } });
    if (body.method !== "tools/call") throw new Error("Unsupported MCP method.");
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    if (name === "workspace_get") {
      if (!hasPermission(identity.context, "workspace:read")) throw new Error("Permission denied.");
      return respond({ jsonrpc: "2.0", id, result: result(workspaceStateForClient(await getWorkspace(identity.context.workspaceId))) });
    }
    if (name === "integrations_list") {
      if (!hasPermission(identity.context, "workspace:read")) throw new Error("Permission denied.");
      return respond({ jsonrpc: "2.0", id, result: result(await listIntegrationSummaries(identity.context.workspaceId)) });
    }
    if (name === "app_run") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const appId = String(args.appId || "");
      const execution = await executeWorkspaceApp({ workspaceId: identity.context.workspaceId, appId, input: String(args.input || ""), source: "mcp" });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.app_run", resourceType: "app", resourceId: appId, metadata: { runId: execution.run.id } }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The app run was saved, but its audit record could not be stored."); }
      try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "app_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The app run was saved, but its usage record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ output: execution.run.output, provider: execution.result.provider, app: execution.app, run: execution.run, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "playbook_run") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const execution = await executeWorkspacePlaybook({ workspaceId: identity.context.workspaceId, playbookId: String(args.playbookId || ""), employeeId: String(args.employeeId || "").trim() || undefined, input: String(args.input || ""), source: "mcp" });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.playbook_run", resourceType: "playbook", resourceId: execution.playbook.id, metadata: { runId: execution.run.id, missionId: execution.mission.id } }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The playbook run was saved, but its audit record could not be stored."); }
      try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "playbook_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The playbook run was saved, but its usage record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ output: execution.run.output, provider: execution.result.provider, playbook: execution.playbook, mission: execution.mission, run: execution.run, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "ticket_reply_draft") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const execution = await executeTicketReplyDraft({ workspaceId: identity.context.workspaceId, ticketId: String(args.ticketId || ""), employeeId: String(args.employeeId || "").trim() || undefined, source: "mcp" });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.ticket_reply_draft", resourceType: "ticket", resourceId: execution.ticket.id, metadata: { employeeId: execution.employee.id } }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The reply draft was saved, but its audit record could not be stored."); }
      try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "ticket_reply_draft", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The reply draft was saved, but its usage record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ output: execution.result.content, provider: execution.result.provider, ticket: execution.ticket, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "ticket_reply_send") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const execution = await executeTicketReplySend({ workspaceId: identity.context.workspaceId, ticketId: String(args.ticketId || ""), body: String(args.body || "").trim() || undefined, senderEmail: identity.context.email });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.gmail_ticket_reply_sent", resourceType: "ticket", resourceId: execution.ticket.id, metadata: { providerMessageId: execution.delivery.messageId, recipient: execution.ticket.requesterEmail } }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The Gmail reply was sent, but its audit record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ ticket: execution.ticket, delivery: execution.delivery, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "deal_create") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const execution = await createWorkspaceDeal({ workspaceId: identity.context.workspaceId, input: { name: String(args.name || ""), company: String(args.company || ""), amount: Number(args.amount || 0), currency: String(args.currency || "USD"), stage: args.stage as never, personId: String(args.personId || "").trim() || null, ownerEmployeeId: String(args.ownerEmployeeId || "").trim() || null, source: String(args.source || "mcp"), nextAction: String(args.nextAction || ""), closeDate: args.closeDate ? String(args.closeDate) : null, notes: String(args.notes || "") } });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.deal_create", resourceType: "deal", resourceId: execution.deal.id }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The deal was saved, but its audit record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ deal: execution.deal, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "deal_update") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const execution = await updateWorkspaceDeal({ workspaceId: identity.context.workspaceId, dealId: String(args.dealId || ""), input: { stage: args.stage as never, stageNote: String(args.stageNote || ""), amount: args.amount === undefined ? undefined : Number(args.amount), nextAction: args.nextAction === undefined ? undefined : String(args.nextAction || ""), closeDate: args.closeDate === undefined ? undefined : (args.closeDate ? String(args.closeDate) : null), notes: args.notes === undefined ? undefined : String(args.notes || ""), ownerEmployeeId: args.ownerEmployeeId === undefined ? undefined : (String(args.ownerEmployeeId || "").trim() || null) } });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.deal_update", resourceType: "deal", resourceId: execution.deal.id, metadata: { stage: execution.deal.stage } }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, execution.state, "The deal was updated, but its audit record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ deal: execution.deal, state: workspaceStateForClient(execution.state) }) });
    }
    if (name === "mission_run") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const current = await getWorkspace(identity.context.workspaceId);
      const mission = missionFrom(current, String(args.missionId || ""));
      if (!mission.employeeId) throw new Error("Assign an employee before running the mission.");
      const employee = employeeFrom(current, mission.employeeId);
      if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a mission run.");
      const task = `${mission.title}\n\nMission: ${mission.description}\n\nUse workspace sources, separate facts from assumptions, and finish with an owner and next action.`;
      const generated = await generateEmployeeReply(employee, task, current.documents);
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const liveMission = missionFrom(workspace, mission.id);
        const liveEmployee = employeeFrom(workspace, employee.id);
        const score = scoreRun(task, generated.content);
        const runId = createId("run");
        const createdAt = timestamp();
        workspace.runs.unshift({ id: runId, employeeId: liveEmployee.id, trigger: "manual", task, output: generated.content, score, reason: "Mission run executed through MCP and left for human review.", status: "completed", createdAt, durationMs: 0, trace: [{ label: "Knowledge", detail: "Retrieved scoped workspace context", durationMs: 0, cost: 0, status: "complete" }, { label: "Worker", detail: generated.provider, durationMs: 0, cost: 1, status: "complete" }, { label: "Evaluator", detail: "Independent rubric score", durationMs: 0, cost: 1, status: "complete" }] });
        workspace.runs = workspace.runs.slice(0, 30);
        workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
        liveMission.status = "needs_review";
        liveMission.output = generated.content;
        liveMission.runId = runId;
        liveMission.updatedAt = createdAt;
        liveEmployee.score = Math.round((liveEmployee.score * 0.65) + (score * 0.35));
        liveEmployee.scoreTrend = [...liveEmployee.scoreTrend.slice(-6), score];
        liveEmployee.lastRunAt = createdAt;
        addActivity(workspace, { type: "mission", title: `${liveMission.title} is ready for review`, detail: `${liveEmployee.name} via MCP · score ${score}` });
        return workspace;
      });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.mission_run", resourceType: "mission", resourceId: mission.id }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The mission was saved, but its audit record could not be stored."); }
      try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "mission_run", unit: "ai", units: 2, provider: generated.provider }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The mission was saved, but its usage record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ output: generated.content, provider: generated.provider, state }) });
    }
    if (name === "mission_approve") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const mission = missionFrom(workspace, String(args.missionId || ""));
        if (mission.status !== "needs_review") throw new Error("Run the mission before approving it.");
        mission.status = "completed";
        mission.updatedAt = timestamp();
        addActivity(workspace, { type: "mission", title: `${mission.title} was approved via MCP`, detail: "Human review completed" });
        return workspace;
      });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.mission_approve", resourceType: "mission", resourceId: String(args.missionId || "") }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The mission was approved, but its audit record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result(state) });
    }
    if (name === "content_generate") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const current = await getWorkspace(identity.context.workspaceId);
      const item = contentFrom(current, String(args.contentId || ""));
      const employee = employeeFrom(current, item.employeeId || current.employees.find((candidate) => candidate.department === "Content")?.id || current.employees[0]?.id || "");
      if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for content generation.");
      const task = `Create a ${item.channel} draft titled "${item.title}". Objective: ${item.objective}. Use only workspace context, preserve the company voice, and call out unsupported claims that need review.`;
      const generated = await generateEmployeeReply(employee, task, current.documents);
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const liveItem = contentFrom(workspace, item.id);
        const liveEmployee = employeeFrom(workspace, employee.id);
        const score = scoreRun(task, generated.content);
        const createdAt = timestamp();
        liveItem.status = "review";
        liveItem.body = generated.content;
        liveItem.employeeId = liveEmployee.id;
        liveItem.updatedAt = createdAt;
        workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
        addActivity(workspace, { type: "content", title: `${liveItem.title} is ready for review`, detail: `${liveEmployee.name} via MCP · score ${score}` });
        return workspace;
      });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.content_generate", resourceType: "content", resourceId: item.id }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The draft was saved, but its audit record could not be stored."); }
      try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "content_generation", unit: "ai", units: 2, provider: generated.provider }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The draft was saved, but its usage record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result({ output: generated.content, provider: generated.provider, state }) });
    }
    if (name === "content_approve") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const item = contentFrom(workspace, String(args.contentId || ""));
        if (!item.body) throw new Error("Generate the content before approving it.");
        item.status = "approved";
        item.updatedAt = timestamp();
        addActivity(workspace, { type: "content", title: `${item.title} was approved via MCP`, detail: "Ready for scheduling" });
        return workspace;
      });
      try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.content_approve", resourceType: "content", resourceId: String(args.contentId || "") }); } catch { if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The content was approved, but its audit record could not be stored."); }
      return respond({ jsonrpc: "2.0", id, result: result(state) });
    }
    if (name === "employee_chat") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const employeeId = String(args.employeeId || "");
      const message = String(args.message || "").trim();
      if (!message) throw new Error("Message is required.");
      const current = await getWorkspace(identity.context.workspaceId);
      const employee = employeeFrom(current, employeeId);
      if (current.workspace.aiCredits.remaining < 1) throw new Error("Not enough AI Credits for chat.");
      const generated = await generateEmployeeReply(employee, message, current.documents);
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        let conversation = workspace.conversations.find((item) => item.employeeId === employeeId);
        if (!conversation) { conversation = { id: createId("conv"), employeeId, messages: [] }; workspace.conversations.unshift(conversation); }
        conversation.messages.push({ id: createId("msg"), role: "user", content: message, createdAt: timestamp() }, { id: createId("msg"), role: "assistant", content: generated.content, citations: generated.citations, createdAt: timestamp() });
        conversation.messages = conversation.messages.slice(-30);
        workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 1);
        addActivity(workspace, { type: "run", title: `${employee.name} answered via MCP`, detail: `${generated.provider} · ${generated.citations.length} source${generated.citations.length === 1 ? "" : "s"}`, });
        return workspace;
      });
      try {
        await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.employee_chat", resourceType: "employee", resourceId: employeeId });
      } catch {
        if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The chat reply was saved, but its audit record could not be stored.");
      }
      try {
        await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "employee_chat", unit: "ai", units: 1, provider: generated.provider });
      } catch {
        if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The chat reply was saved, but its usage record could not be stored.");
      }
      return respond({ jsonrpc: "2.0", id, result: result({ content: generated.content, citations: generated.citations, provider: generated.provider, state }) });
    }
    if (name === "employee_run") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const employeeId = String(args.employeeId || "");
      const task = String(args.task || "").trim();
      const current = await getWorkspace(identity.context.workspaceId);
      const employee = employeeFrom(current, employeeId);
      if (!task) throw new Error("Task is required.");
      if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a run.");
      const generated = await generateEmployeeReply(employee, task, current.documents);
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const score = scoreRun(task, generated.content);
        workspace.runs.unshift({ id: createId("run"), employeeId, trigger: "manual", task, output: generated.content, score, reason: "Run executed through the MCP command surface with the same scoring contract as the web UI.", status: "completed", createdAt: timestamp(), durationMs: 0, trace: [{ label: "Knowledge", detail: "Retrieved scoped workspace context", durationMs: 0, cost: 0, status: "complete" }, { label: "Worker", detail: generated.provider, durationMs: 0, cost: 1, status: "complete" }, { label: "Evaluator", detail: "Independent rubric score", durationMs: 0, cost: 1, status: "complete" }] });
        workspace.runs = workspace.runs.slice(0, 30);
        workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
        addActivity(workspace, { type: "run", title: `${employee.name} completed an MCP run`, detail: task });
        return workspace;
      });
      try {
        await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.employee_run", resourceType: "employee", resourceId: employeeId });
      } catch {
        if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The run was saved, but its audit record could not be stored.");
      }
      try {
        await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "employee_run", unit: "ai", units: 2, provider: generated.provider });
      } catch {
        if (process.env.NODE_ENV === "production") return persistedFailure(id, state, "The run was saved, but its usage record could not be stored.");
      }
      return respond({ jsonrpc: "2.0", id, result: result({ output: generated.content, provider: generated.provider, state }) });
    }
    throw new Error("Unknown MCP tool.");
  } catch (error) {
    return respond({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : "MCP request failed." } }, { status: 400 });
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
