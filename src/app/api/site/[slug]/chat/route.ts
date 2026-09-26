import { NextResponse } from "next/server";
import { addActivity, createId, timestamp } from "@/lib/domain";
import { generateEmployeeReply } from "@/lib/llm";
import { findWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { consumeApiKeyRateLimitPersistent } from "@/lib/rate-limit";
import { widgetKeyHash } from "@/lib/widget";
import { recordAuditEvent } from "@/lib/integration-store";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function locate(slug: string, requestedWorkspaceId: string) {
  const ids = requestedWorkspaceId ? [requestedWorkspaceId] : await listWorkspaceIds();
  for (const workspaceId of ids) {
    const state = await findWorkspace(workspaceId);
    const site = state?.sites.find((candidate) => candidate.slug === slug && candidate.status === "published");
    const agent = site?.agentId ? state?.inboundAgents.find((candidate) => candidate.id === site.agentId && candidate.status === "live") : null;
    if (state && site && agent) return { workspaceId, state, agent };
  }
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: { workspaceId?: unknown; message?: unknown };
  try { body = await request.json() as { workspaceId?: unknown; message?: unknown }; } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const message = String(body.message || "").trim();
  if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "Message is too long." }, { status: 413 });
  const result = await locate(slug, String(body.workspaceId || ""));
  if (!result) return NextResponse.json({ error: "Published site or live inbound agent not found." }, { status: 404 });
  const decision = await consumeApiKeyRateLimitPersistent(widgetKeyHash(`site:${result.workspaceId}:${slug}`), result.workspaceId);
  if (!decision.allowed) return NextResponse.json({ error: "This inbound agent is rate limited. Try again shortly." }, { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } });
  const employee = result.state.employees.find((candidate) => candidate.id === result.agent.employeeId && candidate.status === "live");
  if (!employee) return NextResponse.json({ error: "The inbound agent has no live employee." }, { status: 409 });
  if (result.state.workspace.aiCredits.remaining < 1) return NextResponse.json({ error: "This workspace has no AI Credits remaining." }, { status: 402 });
  const generated = await generateEmployeeReply(employee, message, result.state.documents);
  const sessionId = `site_${createId("session")}`;
  const next = await updateWorkspace(result.workspaceId, (state) => {
    state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 1);
    state.widgetConversations.unshift({ id: createId("site-conversation"), sessionId, employeeId: employee.id, messages: [{ id: createId("site-message"), role: "user", content: message, createdAt: timestamp() }, { id: createId("site-message"), role: "assistant", content: generated.content, citations: generated.citations, createdAt: timestamp() }], createdAt: timestamp(), updatedAt: timestamp() });
    state.widgetConversations = state.widgetConversations.slice(0, 100);
    addActivity(state, { type: "system", title: `${employee.name} answered a published site visitor`, detail: `${generated.provider} · ${generated.citations.length} scoped source${generated.citations.length === 1 ? "" : "s"}` });
    return state;
  });
  await Promise.all([
    recordUsage({ workspaceId: result.workspaceId, actorId: "published-site", feature: "inbound_site_chat", unit: "ai", units: 1, provider: generated.provider }),
    recordAuditEvent({ workspaceId: result.workspaceId, actorId: "published-site", action: "site.chat", resourceType: "site", resourceId: slug, metadata: { citations: generated.citations.length } }).catch(() => undefined),
  ]);
  return NextResponse.json({ message: generated.content, citations: generated.citations, aiCreditsRemaining: next.workspace.aiCredits.remaining }, { headers: { "x-rate-limit-limit": String(decision.limit), "x-rate-limit-remaining": String(decision.remaining) } });
}
