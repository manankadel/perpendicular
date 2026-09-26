import "server-only";

import { addActivity, type Employee, type Ticket, type WorkspaceState } from "@/lib/domain";
import { generateEmployeeReply, type LlmResult } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export type TicketReplyDraftExecution = {
  state: WorkspaceState;
  ticket: Ticket;
  employee: Employee;
  result: LlmResult;
};

function ticketFrom(state: WorkspaceState, ticketId: string) {
  const ticket = state.tickets.find((candidate) => candidate.id === ticketId);
  if (!ticket) throw new Error("Ticket not found.");
  return ticket;
}

function employeeFrom(state: WorkspaceState, employeeId?: string) {
  const requested = employeeId ? state.employees.find((candidate) => candidate.id === employeeId) : undefined;
  const employee = requested?.status === "live"
    ? requested
    : state.employees.find((candidate) => candidate.department === "Support" && candidate.status === "live")
      || state.employees.find((candidate) => candidate.status === "live");
  if (!employee) throw new Error("Create a live support employee before drafting a reply.");
  if (requested && requested.status !== "live") throw new Error("The selected support employee is paused.");
  return employee;
}

export async function executeTicketReplyDraft(args: {
  workspaceId: string;
  ticketId: string;
  employeeId?: string;
  source: "ui" | "api" | "mcp";
}): Promise<TicketReplyDraftExecution> {
  const current = await getWorkspace(args.workspaceId);
  const ticket = ticketFrom(current, args.ticketId);
  const employee = employeeFrom(current, args.employeeId);
  if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a support reply draft.");
  const task = `Draft a concise, human support reply for this ticket. Acknowledge the request, answer only from the workspace knowledge, ask one useful question if evidence is missing, and finish with the next owner action.\n\nSubject: ${ticket.subject}\nRequester: ${ticket.requester}\nPriority: ${ticket.priority}\nMessage: ${ticket.message}`;
  const result = await generateEmployeeReply(employee, task, current.documents);
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    const liveTicket = ticketFrom(workspace, args.ticketId);
    const liveEmployee = employeeFrom(workspace, employee.id);
    liveTicket.replyDraft = result.content;
    liveTicket.replyCitations = result.citations;
    workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
    addActivity(workspace, { type: "ticket", title: `${liveTicket.id} received a grounded reply draft`, detail: `${liveEmployee.name} · ${args.source} · ${result.citations.length} source${result.citations.length === 1 ? "" : "s"} · human send still required` });
    return workspace;
  });
  const saved = ticketFrom(state, args.ticketId);
  const savedEmployee = state.employees.find((candidate) => candidate.id === employee.id);
  if (!savedEmployee) throw new Error("Support reply draft completed but its employee could not be reloaded.");
  return { state, ticket: saved, employee: savedEmployee, result };
}
