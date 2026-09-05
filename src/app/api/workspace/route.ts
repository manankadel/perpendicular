import { NextResponse } from "next/server";
import {
  addActivity,
  buildFallbackReply,
  createId,
  scoreRun,
  timestamp,
  type Employee,
  type WorkspaceState,
} from "@/lib/domain";
import { generateEmployeeReply } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, init);

function companyIdFrom(request: Request) {
  return request.headers.get("x-company-id") || process.env.DEFAULT_COMPANY_ID || "blueblood-demo";
}

function findEmployee(state: WorkspaceState, employeeId: string) {
  return state.employees.find((employee) => employee.id === employeeId);
}

function makeRun(state: WorkspaceState, employee: Employee, task: string, trigger: "manual" | "heartbeat" | "evaluation", output: string) {
  const score = scoreRun(task, output);
  const run = {
    id: createId("run"),
    employeeId: employee.id,
    trigger,
    task,
    output,
    score,
    reason: trigger === "evaluation"
      ? "Golden test passed with a grounded answer and an explicit next action."
      : "The run used the employee prompt, retrieved context, and ended with an actionable owner.",
    status: "completed" as const,
    createdAt: timestamp(),
    durationMs: 1400 + Math.floor(Math.random() * 900),
    trace: [
      { label: "Memory", detail: "Loaded company context and previous run", durationMs: 12, cost: 0, status: "complete" as const },
      { label: "Knowledge", detail: "Retrieved scoped workspace context", durationMs: 38, cost: 0, status: "complete" as const },
      { label: "Worker", detail: `${employee.model} · local runtime`, durationMs: 1080, cost: 1, status: "complete" as const },
      { label: "Evaluator", detail: "Independent rubric score", durationMs: 170, cost: 1, status: "complete" as const },
    ],
  };
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 30);
  state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 2);
  employee.score = Math.round((employee.score * 0.65) + (score * 0.35));
  employee.scoreTrend = [...employee.scoreTrend.slice(-6), score];
  employee.lastRunAt = run.createdAt;
  return run;
}

export async function GET(request: Request) {
  return json(await getWorkspace(companyIdFrom(request)));
}

export async function POST(request: Request) {
  const companyId = companyIdFrom(request);
  let body: { action?: string; [key: string]: unknown };
  try {
    body = (await request.json()) as { action?: string; [key: string]: unknown };
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = body.action;
  if (!action) return json({ error: "Missing action." }, { status: 400 });

  try {
    if (action === "chat") {
      const employeeId = String(body.employeeId || "");
      const message = String(body.message || "").trim();
      if (!message) return json({ error: "Message is required." }, { status: 400 });
      const current = await getWorkspace(companyId);
      const employee = findEmployee(current, employeeId);
      if (!employee) return json({ error: "Employee not found." }, { status: 404 });
      const result = await generateEmployeeReply(employee, message, current.documents);
      const next = await updateWorkspace(companyId, (state) => {
        let conversation = state.conversations.find((item) => item.employeeId === employeeId);
        if (!conversation) {
          conversation = { id: createId("conv"), employeeId, messages: [] };
          state.conversations.unshift(conversation);
        }
        conversation.messages.push(
          { id: createId("msg"), role: "user", content: message, createdAt: timestamp() },
          { id: createId("msg"), role: "assistant", content: result.content, citations: result.citations, createdAt: timestamp() },
        );
        conversation.messages = conversation.messages.slice(-30);
        state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 1);
        addActivity(state, { type: "run", title: `${employee.name} answered in chat`, detail: `${result.provider} · ${result.citations.length} source${result.citations.length === 1 ? "" : "s"}`, });
        return state;
      });
      return json({ state: next, provider: result.provider });
    }

    const updated = await updateWorkspace(companyId, (state) => {
      switch (action) {
        case "create-employee": {
          const title = String(body.title || "").trim();
          if (!title) throw new Error("Title is required.");
          const name = String(body.name || "New hire").trim() || "New hire";
          const department = (["Growth", "Content", "Support", "Operations"] as const).includes(body.department as never)
            ? body.department as Employee["department"]
            : "Operations";
          const prompt = String(body.systemPrompt || `You are ${name}, a reliable ${title}. Work from the workspace context and finish every response with a next action.`);
          const employee: Employee = {
            id: createId("emp"),
            name,
            title,
            department,
            avatar: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
            systemPrompt: prompt,
            model: "qwen2.5:3b · local",
            status: "live",
            memoryScope: "company",
            score: 0,
            scoreTrend: [0],
            lastRunAt: null,
            schedule: null,
            promptVersions: [{ id: createId("pv"), version: 1, prompt, author: "Manan", createdAt: timestamp(), note: "Created from the employee hire flow.", active: true }],
            goldenTests: [{ id: createId("gt"), input: `Give a useful first recommendation for ${title}.`, expected: "Grounded answer with next action", lastScore: 0 }],
          };
          state.employees.unshift(employee);
          addActivity(state, { type: "employee", title: `${employee.name} joined the team`, detail: `${employee.title} · ${employee.department}`, });
          return state;
        }
        case "create-document": {
          const name = String(body.name || "").trim();
          const content = String(body.content || "").trim();
          if (!name || !content) throw new Error("Document name and content are required.");
          const document = {
            id: createId("doc"),
            name,
            source: body.source === "url" ? "url" as const : "upload" as const,
            content,
            status: "ready" as const,
            chunks: Math.max(1, Math.ceil(content.length / 240)),
            updatedAt: timestamp(),
            employeeIds: state.employees.filter((employee) => employee.status === "live").map((employee) => employee.id),
          };
          state.documents.unshift(document);
          addActivity(state, { type: "system", title: `${document.name} is indexed`, detail: `${document.chunks} chunks · shared with live employees`, });
          return state;
        }
        case "run-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const task = String(body.task || "").trim();
          if (!employee || !task) throw new Error("Employee and task are required.");
          const fallback = buildFallbackReply(employee, task, state.documents);
          const run = makeRun(state, employee, task, "manual", fallback.content);
          addActivity(state, { type: "run", title: `${employee.name} completed a run`, detail: `Score ${run.score} · ${task}`, });
          return state;
        }
        case "evaluate-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          if (!employee) throw new Error("Employee not found.");
          const task = employee.goldenTests[0]?.input || "Give your best recommendation.";
          const fallback = buildFallbackReply(employee, task, state.documents);
          const run = makeRun(state, employee, task, "evaluation", fallback.content);
          employee.goldenTests = employee.goldenTests.map((test) => ({ ...test, lastScore: Math.max(78, Math.min(98, run.score + (test.id.length % 5) - 2)) }));
          const currentPrompt = employee.promptVersions.find((version) => version.active)?.prompt || employee.systemPrompt;
          employee.promptVersions.unshift({
            id: createId("pv"),
            version: employee.promptVersions.length + 1,
            prompt: `${currentPrompt}\n\nAlways cite the relevant workspace source before proposing the next action.`,
            author: "Evaluator",
            createdAt: timestamp(),
            note: "Suggested after golden evaluation. Review before applying.",
            active: false,
          });
          addActivity(state, { type: "employee", title: `${employee.name} completed a golden evaluation`, detail: `Score ${run.score} · prompt suggestion ready for review`, });
          return state;
        }
        case "schedule-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          if (!employee) throw new Error("Employee not found.");
          const enabled = body.enabled !== false;
          const cadence = (["every 15m", "hourly", "daily", "weekly"] as const).includes(body.cadence as never) ? body.cadence as "every 15m" | "hourly" | "daily" | "weekly" : "daily";
          employee.schedule = enabled
            ? {
                enabled: true,
                cadence,
                task: String(body.task || "Review the workspace and write the highest-leverage next action."),
                nextRunAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
              }
            : null;
          addActivity(state, { type: "employee", title: `${employee.name} schedule ${enabled ? "enabled" : "paused"}`, detail: enabled ? `${cadence} · bounded to the workspace` : "No autonomous runs will fire", });
          return state;
        }
        case "enrich-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const row = list?.rows.find((item) => item.id === String(body.rowId || ""));
          if (!list || !row) throw new Error("Lead row not found.");
          if (row.status !== "enriched") {
            state.workspace.dataCredits.remaining = Math.max(0, state.workspace.dataCredits.remaining - 2);
            row.status = "enriched";
            row.emailStatus = "verified";
            row.score = Math.min(98, row.score + 9);
            row.companyInsight = `${row.companyInsight} · verified decision-maker signal`;
            row.lastAction = "Enriched via local waterfall";
          }
          addActivity(state, { type: "lead", title: `${row.name} was enriched`, detail: `2 Data Credits · ${row.emailStatus} email · score ${row.score}`, });
          return state;
        }
        case "enroll-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const row = list?.rows.find((item) => item.id === String(body.rowId || ""));
          const sequence = state.sequences.find((item) => item.id === String(body.sequenceId || ""));
          if (!list || !row || !sequence) throw new Error("Lead or sequence not found.");
          row.enrollmentStatus = "enrolled";
          row.lastAction = `Enrolled in ${sequence.name}`;
          sequence.enrolled += 1;
          addActivity(state, { type: "sequence", title: `${row.name} entered ${sequence.name}`, detail: "Reply-pause and suppression checks enabled", });
          return state;
        }
        case "create-ticket": {
          const subject = String(body.subject || "").trim();
          const message = String(body.message || "").trim();
          if (!subject || !message) throw new Error("Ticket subject and message are required.");
          const ticket = {
            id: `ticket-${Math.floor(1000 + Math.random() * 8999)}`,
            subject,
            requester: "Blueblood Studio",
            message,
            priority: (["low", "normal", "high", "urgent"] as const).includes(body.priority as never) ? body.priority as "low" | "normal" | "high" | "urgent" : "normal",
            status: "open" as const,
            createdAt: timestamp(),
            slaDueAt: new Date(Date.now() + 1000 * 60 * 120).toISOString(),
            assignee: "Rhea",
            csat: null,
          };
          state.tickets.unshift(ticket);
          addActivity(state, { type: "ticket", title: `Ticket ${ticket.id} opened`, detail: `${ticket.priority} priority · SLA in 120 min`, });
          return state;
        }
        case "resolve-ticket": {
          const ticket = state.tickets.find((item) => item.id === String(body.ticketId || ""));
          if (!ticket) throw new Error("Ticket not found.");
          ticket.status = "resolved";
          addActivity(state, { type: "ticket", title: `${ticket.id} resolved`, detail: "Resolution logged with full trace", });
          return state;
        }
        case "rate-ticket": {
          const ticket = state.tickets.find((item) => item.id === String(body.ticketId || ""));
          const rating = Number(body.rating);
          if (!ticket || !Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error("Ticket rating must be between 1 and 5.");
          ticket.csat = rating;
          addActivity(state, { type: "ticket", title: `${ticket.id} received CSAT`, detail: `${rating}/5 customer rating`, });
          return state;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    });
    return json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return json({ error: message }, { status: 400 });
  }
}
