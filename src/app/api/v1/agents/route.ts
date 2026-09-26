import { corsHeadersFor, corsJson } from "@/lib/cors";
import { addActivity, createId, timestamp, type Department } from "@/lib/domain";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return corsJson({ error: "workspace:read permission is required." }, { status: 403 }, request);
  const state = await getWorkspace(identity.context.workspaceId);
  return corsJson({ items: state.employees.map((employee) => ({ id: employee.id, name: employee.name, title: employee.title, model: employee.model, status: employee.status, channels: ["api", "mcp"] })), total: state.employees.length, pages: 1, hasNext: false }, undefined, request);
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return corsJson({ error: "title is required." }, { status: 400 }, request);
  const departments: Department[] = ["Growth", "Content", "Support", "Operations"];
  const department = departments.includes(body.department as Department) ? body.department as Department : "Operations";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : title;
  const prompt = typeof body.system_prompt === "string" && body.system_prompt.trim()
    ? body.system_prompt.trim()
    : `You are ${name}, the ${title}. Be grounded in workspace knowledge, separate facts from assumptions, and finish with one clear next action.`;
  const state = await updateWorkspace(identity.context.workspaceId, (workspace) => {
    const createdAt = timestamp();
    const employee = {
      id: createId("emp"), name, title, department, avatar: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), systemPrompt: prompt, model: "Ollama · qwen2.5:3b", status: "live" as const, memoryScope: "company" as const, score: 0, scoreTrend: [0], lastRunAt: null, schedule: null, promptVersions: [{ id: createId("pv"), version: 1, prompt, author: identity.context.firstName || "API", createdAt, note: "Created through the headless API.", active: true }], goldenTests: [{ id: createId("gt"), input: `Give a useful first recommendation for ${title}.`, expected: "Grounded answer with next action", lastScore: 0 }],
    };
    workspace.employees.unshift(employee);
    addActivity(workspace, { type: "employee", title: `${employee.name} joined the team`, detail: `${employee.title} · ${employee.department} · headless API` });
    return workspace;
  });
  await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.employee_create", resourceType: "employee", metadata: { title, department } }).catch(() => undefined);
  const employee = state.employees[0];
  return corsJson({ id: employee.id, name: employee.name, title: employee.title, model: employee.model, status: employee.status, channels: ["api", "mcp"], created: true }, { status: 201 }, request);
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
