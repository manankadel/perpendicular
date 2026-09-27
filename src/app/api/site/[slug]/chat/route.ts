import { NextResponse } from "next/server";
import { addActivity, createId, timestamp } from "@/lib/domain";
import { generateEmployeeReply } from "@/lib/llm";
import { findWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { consumeApiKeyRateLimitPersistent } from "@/lib/rate-limit";
import { widgetKeyHash } from "@/lib/widget";
import { recordAuditEvent } from "@/lib/integration-store";
import { recordUsage } from "@/lib/usage";
import { attributionForSession, recordAttributionTouchInState, touchFromInput, type AttributionInput } from "@/lib/attribution-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validSessionId(value: unknown) {
  const candidate = String(value || "").trim();
  return candidate && candidate.length <= 120 && /^[a-zA-Z0-9:_-]+$/.test(candidate) ? candidate : null;
}

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
  let body: { workspaceId?: unknown; message?: unknown; sessionId?: unknown; attribution?: unknown };
  try { body = await request.json() as { workspaceId?: unknown; message?: unknown; sessionId?: unknown; attribution?: unknown }; } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
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
  const sessionId = validSessionId(body.sessionId) || `site_${createId("session")}`;
  const attribution = body.attribution && typeof body.attribution === "object" ? body.attribution as AttributionInput : undefined;
  const touch = touchFromInput({ sessionId, channel: "site", attribution });
  const existingConversation = result.state.widgetConversations.find((conversation) => conversation.sessionId === sessionId);
  const history = existingConversation?.messages.slice(-8).map((entry) => `${entry.role === "assistant" ? employee.name : "Visitor"}: ${entry.content}`).join("\n") || "";
  const prompt = history
    ? `Continue this visitor conversation. Keep earlier facts consistent and answer the newest visitor message.\n\nConversation so far:\n${history}\n\nNewest visitor message:\n${message}`
    : message;
  const generated = await generateEmployeeReply(employee, prompt, result.state.documents);
  const next = await updateWorkspace(result.workspaceId, (state) => {
    state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 1);
    if (touch) recordAttributionTouchInState(state, touch);
    const conversation = state.widgetConversations.find((candidate) => candidate.sessionId === sessionId);
    if (conversation) {
      conversation.messages.push(
        { id: createId("site-message"), role: "user", content: message, createdAt: timestamp() },
        { id: createId("site-message"), role: "assistant", content: generated.content, citations: generated.citations, createdAt: timestamp() },
      );
      conversation.messages = conversation.messages.slice(-30);
      conversation.updatedAt = timestamp();
      conversation.attribution = conversation.attribution || touch;
    } else {
      state.widgetConversations.unshift({ id: createId("site-conversation"), sessionId, employeeId: employee.id, messages: [{ id: createId("site-message"), role: "user", content: message, createdAt: timestamp() }, { id: createId("site-message"), role: "assistant", content: generated.content, citations: generated.citations, createdAt: timestamp() }], createdAt: timestamp(), updatedAt: timestamp(), attribution: touch });
    }
    state.widgetConversations = state.widgetConversations.slice(0, 100);
    addActivity(state, { type: "system", title: `${employee.name} answered a published site visitor`, detail: `${generated.provider} · ${generated.citations.length} scoped source${generated.citations.length === 1 ? "" : "s"}` });
    return state;
  });
  await Promise.all([
    recordUsage({ workspaceId: result.workspaceId, actorId: "published-site", feature: "inbound_site_chat", unit: "ai", units: 1, provider: generated.provider }),
    recordAuditEvent({ workspaceId: result.workspaceId, actorId: "published-site", action: "site.chat", resourceType: "site", resourceId: slug, metadata: { citations: generated.citations.length } }).catch(() => undefined),
  ]);
  return NextResponse.json({ message: generated.content, citations: generated.citations, sessionId, attribution: attributionForSession(next, sessionId), aiCreditsRemaining: next.workspace.aiCredits.remaining }, { headers: { "x-rate-limit-limit": String(decision.limit), "x-rate-limit-remaining": String(decision.remaining) } });
}
