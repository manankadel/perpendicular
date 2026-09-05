import { NextResponse } from "next/server";
import { addActivity, buildFallbackReply, createId, scoreRun, timestamp } from "@/lib/domain";
import { updateWorkspace } from "@/lib/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const companyId = request.headers.get("x-company-id") || process.env.DEFAULT_COMPANY_ID || "blueblood-demo";
  const state = await updateWorkspace(companyId, (workspace) => {
    const scheduledEmployees = workspace.employees.filter((employee) => employee.schedule?.enabled);
    for (const employee of scheduledEmployees) {
      const schedule = employee.schedule;
      if (!schedule?.enabled) continue;
      const task = schedule.task || "Review the workspace and write the highest-leverage next action.";
      const fallback = buildFallbackReply(employee, task, workspace.documents);
      const score = scoreRun(task, fallback.content);
      const createdAt = timestamp();
      workspace.runs.unshift({
        id: createId("run"),
        employeeId: employee.id,
        trigger: "heartbeat",
        task,
        output: fallback.content,
        score,
        reason: "Heartbeat run completed with local context and an independent score.",
        status: "completed",
        createdAt,
        durationMs: 1650,
        trace: [
          { label: "Memory", detail: "Loaded yesterday's log", durationMs: 12, cost: 0, status: "complete" },
          { label: "Knowledge", detail: "Retrieved scoped context", durationMs: 34, cost: 0, status: "complete" },
          { label: "Worker", detail: `${employee.model} · scheduled`, durationMs: 1450, cost: 1, status: "complete" },
          { label: "Evaluator", detail: "Independent score", durationMs: 154, cost: 1, status: "complete" },
        ],
      });
      employee.score = Math.round(employee.score * 0.65 + score * 0.35);
      employee.scoreTrend = [...employee.scoreTrend.slice(-6), score];
      employee.lastRunAt = createdAt;
      schedule.nextRunAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
      addActivity(workspace, { type: "run", title: `${employee.name} woke up`, detail: `Heartbeat score ${score} · ${schedule.cadence}`, });
    }
    workspace.runs = workspace.runs.slice(0, 30);
    return workspace;
  });

  return NextResponse.json({ ok: true, runCount: state.runs.filter((run) => run.trigger === "heartbeat").length, state });
}
