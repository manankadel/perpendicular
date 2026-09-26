import { NextResponse } from "next/server";
import { addActivity, createId, timestamp } from "@/lib/domain";
import { generateEmployeeReply } from "@/lib/llm";
import { updateWorkspace } from "@/lib/server-store";
import { consumeApiKeyRateLimitPersistent } from "@/lib/rate-limit";
import { widgetKeyHash, authenticateWidget, widgetCorsHeaders, widgetEmployee } from "@/lib/widget";
import { recordAuditEvent } from "@/lib/integration-store";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function keyFromRequest(request: Request) {
  return request.headers.get("x-perpendicular-widget-key") || "";
}

function sessionId(value: unknown) {
  const candidate = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,120}$/.test(candidate) ? candidate : `ws_${createId("session")}`;
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(request) });
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const key = keyFromRequest(request);
  const headers = widgetCorsHeaders(request);
  const connection = await authenticateWidget(workspaceId, key);
  if (!connection) return NextResponse.json({ error: "Widget key is invalid or the widget is disabled." }, { status: 401, headers });
  const decision = await consumeApiKeyRateLimitPersistent(widgetKeyHash(key), workspaceId);
  if (!decision.allowed) return NextResponse.json({ error: "Widget request limit reached. Try again shortly." }, { status: 429, headers: { ...headers, "retry-after": String(decision.retryAfterSeconds) } });
  let body: { message?: unknown; sessionId?: unknown };
  try {
    body = await request.json() as { message?: unknown; sessionId?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers });
  }
  const message = String(body.message || "").trim();
  if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400, headers });
  if (message.length > 10000) return NextResponse.json({ error: "Message is too long." }, { status: 413, headers });
  const employee = widgetEmployee(connection.state);
  if (!employee) return NextResponse.json({ error: "This workspace has no live operator." }, { status: 409, headers });
  if (connection.state.workspace.aiCredits.remaining < 1) return NextResponse.json({ error: "This workspace has no AI Credits remaining." }, { status: 402, headers });
  const generated = await generateEmployeeReply(employee, message, connection.state.documents);
  const currentSessionId = sessionId(body.sessionId);
  let charged = false;
  const next = await updateWorkspace(workspaceId, (state) => {
    if (state.workspace.aiCredits.remaining < 1) return state;
    charged = true;
    let conversation = state.widgetConversations.find((candidate) => candidate.sessionId === currentSessionId);
    if (!conversation) {
      conversation = { id: createId("widget-conversation"), sessionId: currentSessionId, employeeId: employee.id, messages: [], createdAt: timestamp(), updatedAt: timestamp() };
      state.widgetConversations.unshift(conversation);
    }
    conversation.messages.push(
      { id: createId("widget-message"), role: "user", content: message, createdAt: timestamp() },
      { id: createId("widget-message"), role: "assistant", content: generated.content, citations: generated.citations, createdAt: timestamp() },
    );
    conversation.messages = conversation.messages.slice(-30);
    conversation.updatedAt = timestamp();
    state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 1);
    addActivity(state, { type: "system", title: `${employee.name} answered a website visitor`, detail: `${generated.provider} · ${generated.citations.length} scoped source${generated.citations.length === 1 ? "" : "s"}` });
    return state;
  });
  if (!charged) return NextResponse.json({ error: "This workspace has no AI Credits remaining." }, { status: 402, headers });
  await Promise.all([
    recordUsage({ workspaceId, actorId: "widget-visitor", feature: "widget_chat", unit: "ai", units: 1, provider: generated.provider }),
    recordAuditEvent({ workspaceId, actorId: "widget-visitor", action: "widget.chat", resourceType: "employee", resourceId: employee.id, metadata: { sessionId: currentSessionId, citations: generated.citations.length } }).catch(() => undefined),
  ]);
  return NextResponse.json({
    sessionId: currentSessionId,
    message: generated.content,
    citations: generated.citations,
    employee: { id: employee.id, name: employee.name, avatar: employee.avatar },
    provider: generated.provider,
    aiCreditsRemaining: next.workspace.aiCredits.remaining,
  }, { headers: { ...headers, "x-rate-limit-limit": String(decision.limit), "x-rate-limit-remaining": String(decision.remaining), "x-rate-limit-reset": String(Math.ceil(decision.resetAt / 1000)) } });
}
