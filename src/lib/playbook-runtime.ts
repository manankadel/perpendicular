import "server-only";

import { addActivity, createId, scoreRun, timestamp, type Employee, type Mission, type Playbook, type Run, type WorkspaceState } from "@/lib/domain";
import { generateEmployeeReply, type LlmResult } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { playbookTaskFor } from "@/lib/playbook-contract";

export type PlaybookExecution = {
  state: WorkspaceState;
  playbook: Playbook;
  employee: Employee;
  mission: Mission;
  run: Run;
  result: LlmResult;
};

function playbookFrom(state: WorkspaceState, playbookId: string) {
  const playbook = state.playbooks.find((candidate) => candidate.id === playbookId);
  if (!playbook) throw new Error("Playbook not found.");
  if (!playbook.installedAt) throw new Error("Install the playbook before running it.");
  return playbook;
}

function employeeFrom(state: WorkspaceState, employeeId?: string) {
  const requested = employeeId ? state.employees.find((candidate) => candidate.id === employeeId) : undefined;
  const employee = requested?.status === "live"
    ? requested
    : state.employees.find((candidate) => candidate.department === "Operations" && candidate.status === "live")
      || state.employees.find((candidate) => candidate.status === "live");
  if (!employee) throw new Error("Create a live employee before running this playbook.");
  if (requested && requested.status !== "live") throw new Error("The selected playbook operator is paused.");
  return employee;
}

function makeRun(employee: Employee, task: string, result: LlmResult, startedAt: number): Run {
  const createdAt = timestamp();
  return {
    id: createId("run"),
    employeeId: employee.id,
    trigger: "manual",
    task,
    output: result.content,
    score: scoreRun(task, result.content),
    reason: "Playbook execution used the selected live employee and left a reviewable mission.",
    status: "completed",
    createdAt,
    durationMs: Math.max(1, Date.now() - startedAt),
    trace: [
      { label: "Memory", detail: "Loaded workspace state", durationMs: 0, cost: 0, status: "complete" },
      { label: "Knowledge", detail: `${result.citations.length} scoped source${result.citations.length === 1 ? "" : "s"} considered`, durationMs: result.timings.retrievalDurationMs, cost: 0, status: "complete" },
      { label: "Worker", detail: `${employee.model} · ${result.provider}`, durationMs: result.timings.workerDurationMs, cost: 1, status: "complete" },
      { label: "Evaluator", detail: "Independent rubric score", durationMs: 0, cost: 1, status: "complete" },
    ],
  };
}

export async function executeWorkspacePlaybook(args: {
  workspaceId: string;
  playbookId: string;
  employeeId?: string;
  input?: string;
  source: "ui" | "api" | "mcp";
}): Promise<PlaybookExecution> {
  const input = String(args.input || "").trim();
  if (input.length > 10000) throw new Error("Playbook input is too long. Keep it under 10,000 characters.");
  const current = await getWorkspace(args.workspaceId);
  const playbook = playbookFrom(current, args.playbookId);
  const employee = employeeFrom(current, args.employeeId);
  if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for this playbook run.");
  const task = playbookTaskFor(playbook, input);
  const startedAt = Date.now();
  const result = await generateEmployeeReply(employee, task, current.documents);
  const run = makeRun(employee, task, result, startedAt);
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    const livePlaybook = playbookFrom(workspace, args.playbookId);
    const liveEmployee = employeeFrom(workspace, employee.id);
    const mission: Mission = {
      id: createId("mission"),
      title: `${livePlaybook.name} · run`,
      description: livePlaybook.steps.join(" "),
      status: "needs_review",
      priority: "normal",
      employeeId: liveEmployee.id,
      sourceDocumentIds: workspace.documents.map((document) => document.id),
      output: result.content,
      runId: run.id,
      dueAt: null,
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
    };
    workspace.runs.unshift(run);
    workspace.runs = workspace.runs.slice(0, 30);
    workspace.missions.unshift(mission);
    workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
    livePlaybook.lastRunAt = run.createdAt;
    liveEmployee.score = Math.round((liveEmployee.score * 0.65) + (run.score * 0.35));
    liveEmployee.scoreTrend = [...liveEmployee.scoreTrend.slice(-6), run.score];
    liveEmployee.lastRunAt = run.createdAt;
    addActivity(workspace, { type: "playbook", title: `${livePlaybook.name} completed a run`, detail: `${liveEmployee.name} · ${args.source} · score ${run.score} · mission ready for review` });
    return workspace;
  });
  const persistedPlaybook = state.playbooks.find((candidate) => candidate.id === args.playbookId);
  const persistedEmployee = state.employees.find((candidate) => candidate.id === employee.id);
  const mission = state.missions.find((candidate) => candidate.id === run.id || candidate.runId === run.id);
  if (!persistedPlaybook || !persistedEmployee || !mission) throw new Error("Playbook run completed but its persisted result could not be reloaded.");
  return { state, playbook: persistedPlaybook, employee: persistedEmployee, mission, run, result };
}
