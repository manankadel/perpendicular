import { corsHeadersFor, corsJson } from "@/lib/cors";
import { addActivity, createId, scoreRun, timestamp, type WorkspaceState } from "@/lib/domain";
import { listIntegrationSummaries, recordAuditEvent } from "@/lib/integration-store";
import { generateEmployeeReply } from "@/lib/llm";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tools = [
  { name: "workspace_get", description: "Read the authenticated workspace state.", inputSchema: { type: "object", properties: {} } },
  { name: "employee_chat", description: "Ask a named employee and persist the conversation.", inputSchema: { type: "object", required: ["employeeId", "message"], properties: { employeeId: { type: "string" }, message: { type: "string" } } } },
  { name: "employee_run", description: "Run a task through an employee and persist the scored run.", inputSchema: { type: "object", required: ["employeeId", "task"], properties: { employeeId: { type: "string" }, task: { type: "string" } } } },
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
      return respond({ jsonrpc: "2.0", id, result: result(await getWorkspace(identity.context.workspaceId)) });
    }
    if (name === "integrations_list") {
      if (!hasPermission(identity.context, "workspace:read")) throw new Error("Permission denied.");
      return respond({ jsonrpc: "2.0", id, result: result(await listIntegrationSummaries(identity.context.workspaceId)) });
    }
    if (name === "employee_chat") {
      if (!hasPermission(identity.context, "workspace:read")) throw new Error("Permission denied.");
      const employeeId = String(args.employeeId || "");
      const message = String(args.message || "").trim();
      if (!message) throw new Error("Message is required.");
      const current = await getWorkspace(identity.context.workspaceId);
      const employee = employeeFrom(current, employeeId);
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
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.employee_chat", resourceType: "employee", resourceId: employeeId });
      await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "employee_chat", unit: "ai", units: 1, provider: generated.provider });
      return respond({ jsonrpc: "2.0", id, result: result({ content: generated.content, citations: generated.citations, provider: generated.provider, state }) });
    }
    if (name === "employee_run") {
      if (!hasPermission(identity.context, "workspace:write")) throw new Error("Permission denied.");
      const employeeId = String(args.employeeId || "");
      const task = String(args.task || "").trim();
      const current = await getWorkspace(identity.context.workspaceId);
      const employee = employeeFrom(current, employeeId);
      if (!task) throw new Error("Task is required.");
      const generated = await generateEmployeeReply(employee, task, current.documents);
      const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
        const score = scoreRun(task, generated.content);
        workspace.runs.unshift({ id: createId("run"), employeeId, trigger: "manual", task, output: generated.content, score, reason: "Run executed through the MCP command surface with the same scoring contract as the web UI.", status: "completed", createdAt: timestamp(), durationMs: 0, trace: [{ label: "Knowledge", detail: "Retrieved scoped workspace context", durationMs: 0, cost: 0, status: "complete" }, { label: "Worker", detail: generated.provider, durationMs: 0, cost: 1, status: "complete" }, { label: "Evaluator", detail: "Independent rubric score", durationMs: 0, cost: 1, status: "complete" }] });
        workspace.runs = workspace.runs.slice(0, 30);
        workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
        addActivity(workspace, { type: "run", title: `${employee.name} completed an MCP run`, detail: task });
        return workspace;
      });
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "mcp.employee_run", resourceType: "employee", resourceId: employeeId });
      await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "employee_run", unit: "ai", units: 2, provider: generated.provider });
      return respond({ jsonrpc: "2.0", id, result: result({ output: generated.content, provider: generated.provider, state }) });
    }
    throw new Error("Unknown MCP tool.");
  } catch (error) {
    return corsJson({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : "MCP request failed." } }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
