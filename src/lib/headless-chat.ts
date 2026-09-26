import "server-only";

import { addActivity, createId, timestamp, type ConversationMessage, type WorkspaceState } from "@/lib/domain";
import { recordAuditEvent } from "@/lib/integration-store";
import { generateEmployeeReply } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { recordUsage } from "@/lib/usage";

export type HeadlessMessage = { role: string; content: unknown };

export type HeadlessChatResult = {
  employeeId: string;
  employeeName: string;
  content: string;
  citations: string[];
  provider: "ollama" | "local fallback";
  model: string;
  timings: { retrievalDurationMs: number; workerDurationMs: number };
};

function contentText(content: unknown) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const candidate = part as Record<string, unknown>;
    return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
  }).join("\n").trim();
}

export function normalizeHeadlessMessages(value: unknown): HeadlessMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const role = typeof candidate.role === "string" ? candidate.role : "";
    const content = contentText(candidate.content);
    if (!role || !content || !["user", "assistant", "system"].includes(role)) return [];
    return [{ role, content }];
  });
}

function promptForMessages(messages: HeadlessMessage[]) {
  const turns = messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${String(message.content)}`)
    .join("\n\n");
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUser) throw new Error("At least one user message is required.");
  return turns.length > String(latestUser.content).length
    ? `Continue this conversation using the employee's workspace context.\n\n${turns}`
    : String(latestUser.content);
}

function employeeFor(state: WorkspaceState, requestedId: string | undefined) {
  const employee = requestedId
    ? state.employees.find((candidate) => candidate.id === requestedId)
    : state.employees.find((candidate) => candidate.status === "live") || state.employees[0];
  if (!employee) throw new Error("No employee is available in this workspace.");
  if (employee.status !== "live") throw new Error("The requested employee is paused.");
  return employee;
}

export async function executeHeadlessChat(args: {
  workspaceId: string;
  actorId: string;
  employeeId?: string;
  messages: HeadlessMessage[];
  model: string;
}): Promise<HeadlessChatResult> {
  const current = await getWorkspace(args.workspaceId);
  const employee = employeeFor(current, args.employeeId);
  if (current.workspace.aiCredits.remaining < 1) throw new Error("Not enough AI Credits for chat.");
  const prompt = promptForMessages(args.messages);
  const generated = await generateEmployeeReply(employee, prompt, current.documents);
  const assistantMessage: ConversationMessage = {
    id: createId("msg"),
    role: "assistant",
    content: generated.content,
    citations: generated.citations,
    createdAt: timestamp(),
  };
  await updateWorkspace(args.workspaceId, (workspace) => {
    let conversation = workspace.conversations.find((item) => item.employeeId === employee.id);
    if (!conversation) {
      conversation = { id: createId("conv"), employeeId: employee.id, messages: [] };
      workspace.conversations.unshift(conversation);
    }
    const latestUser = [...args.messages].reverse().find((message) => message.role === "user");
    conversation.messages.push(
      { id: createId("msg"), role: "user", content: String(latestUser?.content || prompt), createdAt: timestamp() },
      assistantMessage,
    );
    conversation.messages = conversation.messages.slice(-30);
    workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 1);
    addActivity(workspace, { type: "run", title: `${employee.name} answered through the headless API`, detail: `${generated.provider} · ${generated.citations.length} source${generated.citations.length === 1 ? "" : "s"}` });
    return workspace;
  });
  try {
    await recordAuditEvent({ workspaceId: args.workspaceId, actorId: args.actorId, action: "api.employee_chat", resourceType: "employee", resourceId: employee.id, metadata: { model: args.model } });
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }
  try {
    await recordUsage({ workspaceId: args.workspaceId, actorId: args.actorId, feature: "employee_chat", unit: "ai", units: 1, provider: generated.provider });
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }
  return { employeeId: employee.id, employeeName: employee.name, content: generated.content, citations: generated.citations, provider: generated.provider, model: args.model, timings: generated.timings };
}
