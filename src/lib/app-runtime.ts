import "server-only";

import { addActivity, createId, recordEmployeeScore, scoreRun, timestamp, type AppRecord, type Employee, type Run, type WorkspaceState } from "@/lib/domain";
import { generateEmployeeReply, type LlmResult } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { appTaskFor } from "@/lib/app-contract";

export type AppExecution = {
  state: WorkspaceState;
  app: AppRecord;
  employee: Employee;
  run: Run;
  result: LlmResult;
};

function appFrom(state: WorkspaceState, appId: string) {
  const app = state.apps.find((candidate) => candidate.id === appId);
  if (!app) throw new Error("App not found.");
  if (app.status !== "active") throw new Error("Activate the app before running it.");
  return app;
}

function employeeFrom(state: WorkspaceState, employeeId: string | null) {
  const employee = (employeeId ? state.employees.find((candidate) => candidate.id === employeeId) : undefined)
    || state.employees.find((candidate) => candidate.status === "live");
  if (!employee) throw new Error("Assign a live employee before running the app.");
  if (employee.status !== "live") throw new Error("The app operator is paused.");
  return employee;
}

function makeAppRun(employee: Employee, task: string, result: LlmResult, startedAt: number): Run {
  const score = scoreRun(task, result.content);
  const createdAt = timestamp();
  return {
    id: createId("run"),
    employeeId: employee.id,
    trigger: "manual",
    task,
    output: result.content,
    score,
    reason: "App execution used the assigned employee, scoped workspace context, and left a reviewable trace.",
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

export async function executeWorkspaceApp(args: {
  workspaceId: string;
  appId: string;
  input?: string;
  source: "ui" | "api" | "mcp";
}) : Promise<AppExecution> {
  const input = String(args.input || "").trim();
  if (input.length > 10000) throw new Error("App input is too long. Keep it under 10,000 characters.");
  const current = await getWorkspace(args.workspaceId);
  const app = appFrom(current, args.appId);
  const employee = employeeFrom(current, app.employeeId);
  if (current.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for this app run.");
  const task = appTaskFor(app, input);
  const startedAt = Date.now();
  const result = await generateEmployeeReply(employee, task, current.documents);
  const run = makeAppRun(employee, task, result, startedAt);
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    const liveApp = appFrom(workspace, args.appId);
    const liveEmployee = employeeFrom(workspace, liveApp.employeeId);
    workspace.runs.unshift(run);
    workspace.runs = workspace.runs.slice(0, 30);
    workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
    liveApp.lastRunAt = run.createdAt;
    liveApp.lastRunId = run.id;
    liveApp.lastOutput = run.output;
    liveApp.lastError = null;
    liveApp.runCount = (liveApp.runCount || 0) + 1;
    liveApp.updatedAt = run.createdAt;
    recordEmployeeScore(liveEmployee, run.score);
    liveEmployee.lastRunAt = run.createdAt;
    addActivity(workspace, { type: "run", title: `${liveApp.name} completed`, detail: `${liveEmployee.name} · ${args.source} · score ${run.score}` });
    return workspace;
  });
  const persistedApp = state.apps.find((candidate) => candidate.id === args.appId);
  const persistedEmployee = state.employees.find((candidate) => candidate.id === employee.id);
  if (!persistedApp || !persistedEmployee) throw new Error("App run was completed but the persisted state could not be reloaded.");
  return { state, app: persistedApp, employee: persistedEmployee, run, result };
}

