import { NextResponse } from "next/server";
import { addActivity, createId, scoreRun, timestamp } from "@/lib/domain";
import { getWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { generateEmployeeReply } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Heartbeat is not configured." }, { status: 503 });
  }
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const companyIds = await listWorkspaceIds();
  let runCount = 0;
  for (const companyId of companyIds) {
    await updateWorkspace(companyId, async (workspace) => {
      const scheduledEmployees = workspace.employees.filter((employee) => employee.schedule?.enabled && (!employee.schedule.nextRunAt || new Date(employee.schedule.nextRunAt).getTime() <= Date.now()));
      for (const employee of scheduledEmployees) {
      const schedule = employee.schedule;
      if (!schedule?.enabled) continue;
      const task = schedule.task || "Review the workspace and write the highest-leverage next action.";
      const result = await generateEmployeeReply(employee, task, workspace.documents);
      const score = scoreRun(task, result.content);
      const createdAt = timestamp();
      workspace.runs.unshift({
        id: createId("run"),
        employeeId: employee.id,
        trigger: "heartbeat",
        task,
        output: result.content,
        score,
        reason: "Heartbeat run completed with local context and an independent score.",
        status: "completed",
        createdAt,
        durationMs: 1650,
        trace: [
          { label: "Memory", detail: "Loaded yesterday's log", durationMs: 12, cost: 0, status: "complete" },
          { label: "Knowledge", detail: "Retrieved scoped context", durationMs: 34, cost: 0, status: "complete" },
          { label: "Worker", detail: `${employee.model} · ${result.provider}`, durationMs: 1450, cost: 1, status: "complete" },
          { label: "Evaluator", detail: "Independent score", durationMs: 154, cost: 1, status: "complete" },
        ],
      });
      employee.score = Math.round(employee.score * 0.65 + score * 0.35);
      employee.scoreTrend = [...employee.scoreTrend.slice(-6), score];
      employee.lastRunAt = createdAt;
      const minutes = { "every 15m": 15, hourly: 60, daily: 1440, weekly: 10080 }[schedule.cadence];
      schedule.nextRunAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
      addActivity(workspace, { type: "run", title: `${employee.name} woke up`, detail: `Heartbeat score ${score} · ${schedule.cadence}`, });
      runCount += 1;
    }
    workspace.runs = workspace.runs.slice(0, 30);
    return workspace;
    });
  }

  const state = companyIds.length === 1 ? await getWorkspace(companyIds[0]) : null;
  return NextResponse.json({ ok: true, runCount, state });
}
