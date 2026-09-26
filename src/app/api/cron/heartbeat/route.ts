import { NextResponse } from "next/server";
import { addActivity, createId, scoreRun, timestamp } from "@/lib/domain";
import { getWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { generateEmployeeReply } from "@/lib/llm";
import { claimJob, completeJob, failJob } from "@/lib/job-store";
import { renewGmailWatchIfNeeded } from "@/lib/gmail";
import { recordUsage } from "@/lib/usage";
import { nextAllowedScheduleAt, scheduleExecutionTask, scheduleWindowAllows } from "@/lib/scheduling";

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
  let failedCount = 0;
  for (const companyId of companyIds) {
    const snapshot = await getWorkspace(companyId);
    await renewGmailWatchIfNeeded(companyId).catch(() => undefined);
    const scheduledEmployees = snapshot.employees.filter((employee) => employee.schedule?.enabled && (!employee.schedule.nextRunAt || new Date(employee.schedule.nextRunAt).getTime() <= Date.now()));
    for (const employeeSnapshot of scheduledEmployees) {
      const schedule = employeeSnapshot.schedule;
      if (!schedule?.enabled) continue;
      const scheduledFor = schedule.nextRunAt || "immediate";
      const claim = await claimJob({
        workspaceId: companyId,
        kind: "employee-heartbeat",
        idempotencyKey: `heartbeat:${companyId}:${employeeSnapshot.id}:${scheduledFor}`,
        payload: { employeeId: employeeSnapshot.id, scheduledFor },
      });
      if (!claim) continue;
      let ran = false;
      try {
        await updateWorkspace(companyId, async (workspace) => {
          const employee = workspace.employees.find((candidate) => candidate.id === employeeSnapshot.id);
          const currentSchedule = employee?.schedule;
          if (!employee || !currentSchedule?.enabled) return workspace;
          if (workspace.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for heartbeat work.");
          const task = currentSchedule.task || "Review the workspace and write the highest-leverage next action.";
          const startedAt = Date.now();
          const result = await generateEmployeeReply(employee, task, workspace.documents);
          const scoringStartedAt = Date.now();
          const score = scoreRun(task, result.content);
          const scoringDurationMs = Math.max(0, Date.now() - scoringStartedAt);
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
            durationMs: Math.max(1, Date.now() - startedAt),
            trace: [
              { label: "Memory", detail: "Loaded workspace state", durationMs: 0, cost: 0, status: "complete" },
              { label: "Knowledge", detail: `${result.citations.length} scoped source${result.citations.length === 1 ? "" : "s"} considered`, durationMs: result.timings.retrievalDurationMs, cost: 0, status: "complete" },
              { label: "Worker", detail: `${employee.model} · ${result.provider}`, durationMs: result.timings.workerDurationMs, cost: 1, status: "complete" },
              { label: "Evaluator", detail: "Independent rubric score", durationMs: scoringDurationMs, cost: 1, status: "complete" },
            ],
          });
          employee.score = Math.round(employee.score * 0.65 + score * 0.35);
          employee.scoreTrend = [...employee.scoreTrend.slice(-6), score];
          employee.lastRunAt = createdAt;
          const minutes = { "every 15m": 15, hourly: 60, daily: 1440, weekly: 10080 }[currentSchedule.cadence];
          currentSchedule.nextRunAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
          workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
          addActivity(workspace, { type: "run", title: `${employee.name} woke up`, detail: `Heartbeat score ${score} · ${currentSchedule.cadence}`, });
          ran = true;
          workspace.runs = workspace.runs.slice(0, 30);
          return workspace;
        });
        await completeJob(claim);
        if (ran) await recordUsage({ workspaceId: companyId, actorId: "heartbeat", feature: "heartbeat_run", unit: "ai", units: 2 });
        if (ran) runCount += 1;
      } catch (error) {
        failedCount += 1;
        await failJob(claim, error).catch(() => undefined);
      }
    }
    const scheduledWork = snapshot.schedules.filter((schedule) => schedule.active && new Date(schedule.nextRunAt).getTime() <= Date.now());
    for (const scheduleSnapshot of scheduledWork) {
      const claim = await claimJob({
        workspaceId: companyId,
        kind: "scheduled-work",
        idempotencyKey: `scheduled:${companyId}:${scheduleSnapshot.id}:${scheduleSnapshot.nextRunAt}`,
        payload: { scheduleId: scheduleSnapshot.id, scheduledFor: scheduleSnapshot.nextRunAt },
      });
      if (!claim) continue;
      let ran = false;
      try {
        await updateWorkspace(companyId, async (workspace) => {
          const schedule = workspace.schedules.find((candidate) => candidate.id === scheduleSnapshot.id);
          const employee = schedule?.employeeId ? workspace.employees.find((candidate) => candidate.id === schedule.employeeId) : workspace.employees.find((candidate) => candidate.status === "live");
          if (!schedule || !schedule.active || !employee) return workspace;
          if (!scheduleWindowAllows(schedule, workspace.profile.timezone, new Date())) {
            schedule.nextRunAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            return workspace;
          }
          if (workspace.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for scheduled work.");
          const startedAt = Date.now();
          const task = scheduleExecutionTask(schedule);
          const result = await generateEmployeeReply(employee, task, workspace.documents);
          const scoringStartedAt = Date.now();
          const score = scoreRun(schedule.description, result.content);
          const createdAt = timestamp();
          workspace.runs.unshift({
            id: createId("run"),
            employeeId: employee.id,
            trigger: "heartbeat",
            task,
            output: result.content,
            score,
            reason: "Scheduled work completed with local context and an independent score.",
            status: "completed",
            createdAt,
            durationMs: Math.max(1, Date.now() - startedAt),
            trace: [
              { label: "Memory", detail: "Loaded workspace state", durationMs: 0, cost: 0, status: "complete" },
              { label: "Knowledge", detail: `${result.citations.length} scoped source${result.citations.length === 1 ? "" : "s"} considered`, durationMs: result.timings.retrievalDurationMs, cost: 0, status: "complete" },
              { label: "Worker", detail: `${employee.model} · ${result.provider}`, durationMs: result.timings.workerDurationMs, cost: 1, status: "complete" },
              { label: "Evaluator", detail: "Independent rubric score", durationMs: Math.max(0, Date.now() - scoringStartedAt), cost: 1, status: "complete" },
            ],
          });
          employee.score = employee.score > 0 ? Math.round(employee.score * 0.65 + score * 0.35) : score;
          employee.scoreTrend = [...employee.scoreTrend.filter((value) => value > 0).slice(-6), score];
          employee.lastRunAt = createdAt;
          schedule.lastRunAt = createdAt;
          schedule.runCount += 1;
          schedule.lastOutput = result.content;
          schedule.runLog = [{ runId: workspace.runs[0].id, createdAt, output: result.content, score }, ...(schedule.runLog || [])].slice(0, 20);
          if (schedule.cadence === "once") schedule.active = false;
          else {
            schedule.nextRunAt = nextAllowedScheduleAt(schedule, workspace.profile.timezone, Date.now());
          }
          workspace.workspace.aiCredits.remaining = Math.max(0, workspace.workspace.aiCredits.remaining - 2);
          addActivity(workspace, { type: "run", title: `${schedule.name} woke up`, detail: `${employee.name} · score ${score} · ${schedule.cadence}` });
          workspace.runs = workspace.runs.slice(0, 30);
          ran = true;
          return workspace;
        });
        await completeJob(claim);
        if (ran) await recordUsage({ workspaceId: companyId, actorId: "heartbeat", feature: "scheduled_run", unit: "ai", units: 2 });
        if (ran) runCount += 1;
      } catch (error) {
        failedCount += 1;
        await failJob(claim, error).catch(() => undefined);
      }
    }
  }

  const state = companyIds.length === 1 ? await getWorkspace(companyIds[0]) : null;
  return NextResponse.json({ ok: true, runCount, failedCount, state });
}
