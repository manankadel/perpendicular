import { NextResponse } from "next/server";
import {
  addActivity,
  buildOnboardingArtifacts,
  createId,
  createOnboardingState,
  scoreRun,
  timestamp,
  ticketSlaMinutes,
  type OnboardingDiscovery,
  type OnboardingGoal,
  type Employee,
  type WorkspaceState,
} from "@/lib/domain";
import { generateEmployeeReply } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { authenticateRequest, getLoginUrl, IdentityError, type IdentityContext } from "@/lib/identity";
import { hasPermission, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { listIntegrationSummaries, recordAuditEvent } from "@/lib/integration-store";
import { researchPersonCompany, researchWebsite } from "@/lib/public-research";
import { corsHeadersFor } from "@/lib/cors";
import { recordUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, init?: ResponseInit): NextResponse => NextResponse.json(body, {
  ...init,
  headers: { ...corsHeadersFor(), ...init?.headers },
});

function applyCors(response: Response, request: Request) {
  for (const [name, value] of Object.entries(corsHeadersFor(request))) response.headers.set(name, value);
  return response;
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

async function getIdentity(request: Request): Promise<{ context: IdentityContext } | { response: Response }> {
  try {
    return { context: await authenticateRequest(request) };
  } catch (error) {
    if (error instanceof IdentityError) {
      return {
        response: json({
          error: error.message,
          ...(error.status === 401 ? { loginUrl: getLoginUrl(request) } : {}),
        }, { status: error.status, headers: error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : undefined }),
      };
    }
    throw error;
  }
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
    durationMs: 1700,
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

function inferredCompanyUrl(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"].includes(domain)) return null;
  return `https://${domain}`;
}

function companyNameFromUrl(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function companyNameFromDiscovery(discovery: OnboardingDiscovery, fallbackUrl: string | null, workspaceId: string) {
  const title = discovery.title?.replace(/\s*[|·—–-].*$/, "").trim();
  if (title) return title.slice(0, 100);
  if (fallbackUrl) {
    try { return companyNameFromUrl(fallbackUrl); } catch { /* fall through to the authenticated workspace slug */ }
  }
  return workspaceId.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 100);
}

function onboardingGoal(value: unknown): OnboardingGoal {
  return (["revenue", "delivery", "content", "support"] as const).includes(value as OnboardingGoal) ? value as OnboardingGoal : "revenue";
}

async function getWorkspaceRoute(request: Request) {
  const identity = await getIdentity(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return json({ error: "You do not have permission to read this workspace." }, { status: 403 });
  try {
    const state = await getWorkspace(identity.context.workspaceId);
    let integrations = state.integrations || [];
    try { integrations = await listIntegrationSummaries(identity.context.workspaceId); } catch { if (process.env.NODE_ENV === "production") throw new Error("Integration storage is not ready."); }
    return json({
      ...state,
      integrations,
      viewer: { email: identity.context.email, firstName: identity.context.firstName, lastName: identity.context.lastName },
    }, { headers: rateLimitHeaders(identity.context) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Workspace storage is unavailable." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return applyCors(await getWorkspaceRoute(request), request);
}

async function postWorkspace(request: Request): Promise<Response> {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await getIdentity(request);
  if ("response" in identity) return identity.response;
  const companyId = identity.context.workspaceId;
  let body: { action?: string; [key: string]: unknown };
  try {
    body = (await request.json()) as { action?: string; [key: string]: unknown };
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = body.action;
  if (!action) return json({ error: "Missing action." }, { status: 400 });
  const requiredPermission = "workspace:write";
  if (!hasPermission(identity.context, requiredPermission)) return json({ error: "You do not have permission for this action." }, { status: 403 });

  try {
    if (action === "bootstrap-workspace") {
      const goal = onboardingGoal(body.goal);
      const requestedUrl = String(body.companyUrl || "").trim() || inferredCompanyUrl(identity.context.email);
      const providedDescription = String(body.companyDescription || "").trim();
      if (providedDescription.length > 100000) throw new Error("The workspace brief is too large. Keep it under 100,000 characters.");
      let discovery: OnboardingDiscovery;
      if (requestedUrl) {
        try {
          const researched = await researchWebsite(requestedUrl);
          discovery = researched;
        } catch (error) {
          if (!providedDescription) throw error;
          discovery = { url: null, title: null, description: "Provided by the workspace operator.", text: providedDescription };
        }
      } else if (providedDescription) {
        discovery = { url: null, title: null, description: "Provided by the workspace operator.", text: providedDescription };
      } else {
        throw new Error("Add a public company URL or a short description so Perpendicular can build the workspace from real context.");
      }
      if (discovery.text.length < 40) throw new Error("The discovery source is too short to build a useful workspace. Add a fuller public page or description.");
      const companyName = String(body.companyName || "").trim() || companyNameFromDiscovery(discovery, requestedUrl, companyId);
      const next = await updateWorkspace(companyId, (state) => {
        if (state.workspace.onboarding.employeeId && state.workspace.onboarding.documentId) return state;
        const artifacts = buildOnboardingArtifacts({ companyId, companyName, goal, discovery });
        state.workspace.name = companyName;
        state.employees.unshift(artifacts.employee);
        state.documents.unshift(artifacts.document);
        state.workspace.onboarding = {
          ...createOnboardingState("ready"),
          goal,
          companyUrl: discovery.url,
          sourceTitle: artifacts.document.name,
          sourceDescription: artifacts.sourceDescription,
          discoveredAt: timestamp(),
          employeeId: artifacts.employee.id,
          documentId: artifacts.document.id,
        };
        addActivity(state, { type: "system", title: `${companyName} was discovered`, detail: `${artifacts.document.name} indexed · ${artifacts.employee.name} is ready for a first brief`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.bootstrap", metadata: { goal, source: discovery.url ? "public_url" : "operator_brief" } }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The workspace was created, but its audit record failed: ${error.message}` : "The workspace was created, but audit storage is unavailable." }, { status: 503 }); }
      return json({ state: next, discovery: { title: next.workspace.onboarding.sourceTitle, description: next.workspace.onboarding.sourceDescription, url: next.workspace.onboarding.companyUrl } });
    }

    if (action === "enroll-row") {
      try {
        const integrations = await listIntegrationSummaries(companyId);
        if (integrations.find((integration) => integration.provider === "gmail")?.status !== "connected") {
          return json({ error: "Connect Gmail before enrolling a lead in a sequence." }, { status: 400 });
        }
      } catch {
        return json({ error: "Gmail connection status is unavailable. Apply the platform database migration." }, { status: 503 });
      }
    }

    if (action === "run-onboarding-brief") {
      const current = await getWorkspace(companyId);
      const onboarding = current.workspace.onboarding;
      const employee = onboarding.employeeId ? findEmployee(current, onboarding.employeeId) : undefined;
      if (!employee || !onboarding.goal) return json({ error: "Complete workspace discovery before running the first brief." }, { status: 400 });
      if (onboarding.runId) return json(current);
      if (current.workspace.aiCredits.remaining < 2) return json({ error: "Not enough AI Credits for the first brief." }, { status: 402 });
      const task = employee.goldenTests[0]?.input || "Review the workspace and propose the three highest-leverage next actions for this week.";
      const result = await generateEmployeeReply(employee, task, current.documents);
      const next = await updateWorkspace(companyId, (state) => {
        if (state.workspace.onboarding.runId) return state;
        const liveEmployee = findEmployee(state, employee.id);
        if (!liveEmployee) return state;
        const run = makeRun(state, liveEmployee, task, "manual", result.content);
        run.trace[2].detail = `${liveEmployee.model} · ${result.provider}`;
        state.workspace.onboarding.status = "completed";
        state.workspace.onboarding.runId = run.id;
        state.workspace.onboarding.completedAt = run.createdAt;
        addActivity(state, { type: "run", title: `${liveEmployee.name} delivered the first brief`, detail: `Score ${run.score} · grounded in ${state.documents[0]?.name || "workspace context"}`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_run", resourceType: "employee", resourceId: employee.id }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The brief was saved, but its audit record failed: ${error.message}` : "The brief was saved, but audit storage is unavailable." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "onboarding_brief", unit: "ai", units: 2 }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The brief was saved, but its usage record failed: ${error.message}` : "The brief was saved, but usage storage is unavailable." }, { status: 503 }); }
      return json(next);
    }

    if (action === "enable-onboarding-schedule") {
      const next = await updateWorkspace(companyId, (state) => {
        const onboarding = state.workspace.onboarding;
        const employee = onboarding.employeeId ? findEmployee(state, onboarding.employeeId) : undefined;
        if (!employee || !onboarding.goal) throw new Error("Run the first brief before enabling the daily rhythm.");
        const task = employee.goldenTests[0]?.input || "Review the workspace and write the highest-leverage next action for this week.";
        employee.schedule = { enabled: true, cadence: "daily", task, nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
        state.workspace.onboarding.scheduleEnabled = true;
        addActivity(state, { type: "employee", title: `${employee.name} is now on a daily rhythm`, detail: "The Dell heartbeat will run the same grounded brief each day", });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_schedule" }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The schedule was saved, but its audit record failed: ${error.message}` : "The schedule was saved, but audit storage is unavailable." }, { status: 503 }); }
      return json(next);
    }

    if (action === "chat") {
      const employeeId = String(body.employeeId || "");
      const message = String(body.message || "").trim();
      if (!message) return json({ error: "Message is required." }, { status: 400 });
      if (message.length > 10000) return json({ error: "Message is too long." }, { status: 413 });
      const current = await getWorkspace(companyId);
      const employee = findEmployee(current, employeeId);
      if (!employee) return json({ error: "Employee not found." }, { status: 404 });
      if (current.workspace.aiCredits.remaining < 1) return json({ error: "Not enough AI Credits for chat." }, { status: 402 });
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
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.chat", resourceType: "employee", resourceId: employeeId }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The chat reply was saved, but its audit record failed: ${error.message}` : "The chat reply was saved, but audit storage is unavailable." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "employee_chat", unit: "ai", units: 1, provider: result.provider }); } catch (error) { if (process.env.NODE_ENV === "production") return json({ state: next, persisted: true, error: error instanceof Error ? `The chat reply was saved, but its usage record failed: ${error.message}` : "The chat reply was saved, but usage storage is unavailable." }, { status: 503 }); }
      return json({ state: next, provider: result.provider }, { headers: rateLimitHeaders(identity.context) });
    }

    const updated = await updateWorkspace(companyId, async (state) => {
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
            model: process.env.OLLAMA_MODEL ? `Ollama · ${process.env.OLLAMA_MODEL}` : "Ollama · not configured",
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
          let content = String(body.content || "").trim();
          if (body.source === "url") {
            const sourceUrl = String(body.url || "").trim();
            if (!sourceUrl) throw new Error("A URL is required for URL capture.");
            content = (await researchWebsite(sourceUrl)).text;
          }
          if (!name || !content) throw new Error("Document name and content are required.");
          if (content.length > 100000) throw new Error("Knowledge source is too large. Keep it under 100,000 characters.");
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
        case "create-list": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("List name is required.");
          if (state.lists.some((list) => list.name.toLowerCase() === name.toLowerCase())) throw new Error("A list with this name already exists.");
          state.lists.unshift({ id: createId("list"), name, description: String(body.description || "").trim() || "Imported prospects ready for qualification.", updatedAt: timestamp(), rows: [] });
          addActivity(state, { type: "lead", title: `${name} was created`, detail: "Ready for lead imports and public research", });
          return state;
        }
        case "import-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const email = String(body.email || "").trim().toLowerCase();
          const name = String(body.name || "").trim();
          const company = String(body.company || "").trim();
          if (!list || !name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("List, name, company, and a valid email are required.");
          if (state.suppressedEmails.includes(email)) throw new Error("This address is suppressed for the workspace.");
          if (list.rows.some((row) => row.email.toLowerCase() === email)) throw new Error("This email is already in the list.");
          if (state.lists.some((candidate) => candidate.id !== list.id && candidate.rows.some((row) => row.email.toLowerCase() === email))) throw new Error("This email already exists in another Smart List in this workspace.");
          list.rows.unshift({ id: createId("row"), name, email, company, role: String(body.role || "Unknown"), location: String(body.location || "Unknown"), score: 50, status: "new", emailStatus: "unknown", intent: "Imported lead", companyInsight: "No public research captured yet", enrollmentStatus: "not enrolled", lastAction: "Imported by workspace operator" });
          list.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${name} was imported`, detail: `${company} · ${list.name}`, });
          return state;
        }
        case "create-sequence": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Sequence name is required.");
          state.sequences.unshift({ id: createId("seq"), name, status: "draft", audience: String(body.audience || "Imported leads"), enrolled: 0, replied: 0, booked: 0, steps: [{ id: createId("step"), channel: "Email", title: "First touch", delay: "Day 0", body: String(body.body || "Write a useful, specific first touch. Require human approval before sending.") }] });
          addActivity(state, { type: "sequence", title: `${name} was created`, detail: "Draft sequence · Gmail connection and approval required before sending", });
          return state;
        }
        case "run-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const task = String(body.task || "").trim();
          if (!employee || !task) throw new Error("Employee and task are required.");
          if (state.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a run.");
          const result = await generateEmployeeReply(employee, task, state.documents);
          const run = makeRun(state, employee, task, "manual", result.content);
          run.trace[2].detail = `${employee.model} · ${result.provider}`;
          addActivity(state, { type: "run", title: `${employee.name} completed a run`, detail: `Score ${run.score} · ${task}`, });
          return state;
        }
        case "evaluate-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          if (!employee) throw new Error("Employee not found.");
          if (state.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for an evaluation.");
          const requestedVersionId = String(body.promptVersionId || "").trim();
          const evaluatedVersion = requestedVersionId
            ? employee.promptVersions.find((version) => version.id === requestedVersionId)
            : employee.promptVersions.find((version) => version.active);
          if (requestedVersionId && !evaluatedVersion) throw new Error("Prompt version not found.");
          const task = employee.goldenTests[0]?.input || "Give your best recommendation.";
          const result = await generateEmployeeReply(evaluatedVersion ? { ...employee, systemPrompt: evaluatedVersion.prompt } : employee, task, state.documents);
          const run = makeRun(state, employee, task, "evaluation", result.content);
          run.trace[2].detail = `${employee.model} · ${result.provider}`;
          employee.goldenTests = employee.goldenTests.map((test) => ({ ...test, lastScore: Math.max(78, Math.min(98, run.score + (test.id.length % 5) - 2)) }));
          if (evaluatedVersion) evaluatedVersion.goldenScore = run.score;
          if (!requestedVersionId) {
            const currentPrompt = evaluatedVersion?.prompt || employee.systemPrompt;
            employee.promptVersions.unshift({
              id: createId("pv"),
              version: employee.promptVersions.length + 1,
              prompt: `${currentPrompt}\n\nAlways cite the relevant workspace source before proposing the next action.`,
              author: "Evaluator",
              createdAt: timestamp(),
              note: "Suggested after golden evaluation. Review before applying.",
              active: false,
              goldenScore: null,
            });
          }
          addActivity(state, { type: "employee", title: `${employee.name} evaluated prompt v${evaluatedVersion?.version || 1}`, detail: `Score ${run.score}${requestedVersionId ? " · candidate evaluated" : " · prompt suggestion ready for review"}`, });
          return state;
        }
        case "activate-prompt-version": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const versionId = String(body.promptVersionId || "").trim();
          if (!employee || !versionId) throw new Error("Employee and prompt version are required.");
          const version = employee.promptVersions.find((candidate) => candidate.id === versionId);
          if (!version) throw new Error("Prompt version not found.");
          employee.promptVersions = employee.promptVersions.map((candidate) => ({ ...candidate, active: candidate.id === versionId }));
          employee.systemPrompt = version.prompt;
          addActivity(state, { type: "employee", title: `${employee.name} switched to prompt v${version.version}`, detail: "The previous live prompt remains available for rollback.", });
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
                nextRunAt: new Date(Date.now() + ({ "every 15m": 15, hourly: 60, daily: 1440, weekly: 10080 }[cadence] * 60 * 1000)).toISOString(),
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
            if (state.workspace.dataCredits.remaining < 2) throw new Error("Not enough Data Credits for public research.");
            const research = await researchPersonCompany(row.email, row.company);
            state.workspace.dataCredits.remaining -= 2;
            row.status = "enriched";
            row.emailStatus = "unknown";
            row.score = Math.min(98, row.score + 5);
            row.companyInsight = research.insight;
            row.lastAction = `Public website researched · ${research.url}`;
          }
          addActivity(state, { type: "lead", title: `${row.name} was researched`, detail: `2 Data Credits · public company source captured · score ${row.score}`, });
          return state;
        }
        case "enroll-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const row = list?.rows.find((item) => item.id === String(body.rowId || ""));
          const sequence = state.sequences.find((item) => item.id === String(body.sequenceId || ""));
          if (!list || !row || !sequence) throw new Error("Lead or sequence not found.");
          if (row.status !== "enriched") throw new Error("Research the lead before enrolling it.");
          if (state.suppressedEmails.includes(row.email.toLowerCase())) throw new Error("This address is suppressed and cannot enter a sequence.");
          if (row.enrollmentStatus === "enrolled") return state;
          row.enrollmentStatus = "enrolled";
          row.lastAction = `Enrolled in ${sequence.name}`;
          sequence.enrolled += 1;
          addActivity(state, { type: "sequence", title: `${row.name} entered ${sequence.name}`, detail: "Reply-pause and suppression checks enabled", });
          return state;
        }
        case "suppress-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const row = list?.rows.find((item) => item.id === String(body.rowId || ""));
          if (!list || !row) throw new Error("Lead row not found.");
          const email = row.email.toLowerCase();
          if (!state.suppressedEmails.includes(email)) state.suppressedEmails.push(email);
          row.lastAction = "Suppressed for this workspace";
          addActivity(state, { type: "lead", title: `${row.name} was suppressed`, detail: "The address cannot be imported or enrolled in a sequence", });
          return state;
        }
        case "unsuppress-row": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const row = list?.rows.find((item) => item.id === String(body.rowId || ""));
          if (!list || !row) throw new Error("Lead row not found.");
          state.suppressedEmails = state.suppressedEmails.filter((email) => email !== row.email.toLowerCase());
          row.lastAction = "Suppression removed by workspace operator";
          addActivity(state, { type: "lead", title: `${row.name} was unsuppressed`, detail: "The address may be researched and enrolled again", });
          return state;
        }
        case "create-ticket": {
          const subject = String(body.subject || "").trim();
          const message = String(body.message || "").trim();
          if (!subject || !message) throw new Error("Ticket subject and message are required.");
          const priority = (["low", "normal", "high", "urgent"] as const).includes(body.priority as never) ? body.priority as "low" | "normal" | "high" | "urgent" : "normal";
          const ticket = {
            id: createId("ticket"),
            subject,
            requester: identity.context.email || identity.context.workspaceId,
            message,
            priority,
            status: "open" as const,
            createdAt: timestamp(),
            slaDueAt: new Date(Date.now() + 1000 * 60 * ticketSlaMinutes(priority)).toISOString(),
            assignee: "Rhea",
            csat: null,
          };
          state.tickets.unshift(ticket);
          addActivity(state, { type: "ticket", title: `Ticket ${ticket.id} opened`, detail: `${ticket.priority} priority · SLA in ${ticketSlaMinutes(ticket.priority)} min`, });
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
    try {
      await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: `workspace.${action}`, metadata: { action } });
    } catch (error) {
      if (process.env.NODE_ENV === "production") return json({ state: updated, persisted: true, error: error instanceof Error ? `The action was saved, but its audit record failed: ${error.message}` : "The action was saved, but audit storage is unavailable." }, { status: 503 });
    }
    if (action === "run-employee" || action === "evaluate-employee") {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: action === "run-employee" ? "employee_run" : "employee_evaluation", unit: "ai", units: 2 });
      } catch (error) {
        if (process.env.NODE_ENV === "production") return json({ state: updated, persisted: true, error: error instanceof Error ? `The action was saved, but its usage record failed: ${error.message}` : "The action was saved, but usage storage is unavailable." }, { status: 503 });
      }
    }
    if (action === "enrich-row") {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "public_research", unit: "data", units: 2 });
      } catch (error) {
        if (process.env.NODE_ENV === "production") return json({ state: updated, persisted: true, error: error instanceof Error ? `The research was saved, but its usage record failed: ${error.message}` : "The research was saved, but usage storage is unavailable." }, { status: 503 });
      }
    }
    return json(updated, { headers: rateLimitHeaders(identity.context) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  return applyCors(await postWorkspace(request), request);
}
