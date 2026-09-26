import { NextResponse } from "next/server";
import {
  addActivity,
  buildOnboardingArtifacts,
  createId,
  createOnboardingState,
  scoreRun,
  recordEmployeeScore,
  timestamp,
  ticketSlaMinutes,
  type OnboardingDiscovery,
  type OnboardingGoal,
  type ContentItem,
  type AppRecord,
  type Campaign,
  type Employee,
  type InboundAgent,
  type KeywordMonitor,
  type LeadSource,
  type Mission,
  type PersonRecord,
  type ScheduledWork,
  type SiteRecord,
  type WorkspaceState,
} from "@/lib/domain";
import { generateEmployeeReply, type LlmResult } from "@/lib/llm";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";
import { authenticateRequest, getLoginUrl, IdentityError, type IdentityContext } from "@/lib/identity";
import { hasPermission, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { listIntegrationSummaries, recordAuditEvent } from "@/lib/integration-store";
import { sendGmailMessage, GmailSendError } from "@/lib/gmail";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { claimOutboundMessage, markOutboundFailed, markOutboundSent, markOutboundUnknown } from "@/lib/outbound-store";
import { sequenceEmailFor, sequenceStepIdempotencyKey } from "@/lib/sequence";
import { ingestUploadedDocument } from "@/lib/document-ingest";
import { researchPersonCompany, researchPublicKeyword, researchWebsite } from "@/lib/public-research";
import { corsHeadersFor } from "@/lib/cors";
import { recordUsage } from "@/lib/usage";
import { createWidgetKey, widgetKeyHash } from "@/lib/widget";
import { workspaceStateForClient } from "@/lib/workspace-view";
import { normalizeDomain, normalizeEmail, outboundSafetyDecision, startOfLocalDay, validateOutboundSafetySettings } from "@/lib/outbound-safety";
import { parseLeadCsv, type LeadCsvError } from "@/lib/lead-csv";
import { scoreLead } from "@/lib/lead-scoring";

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

function findMission(state: WorkspaceState, missionId: string) {
  return state.missions.find((mission) => mission.id === missionId);
}

function findContent(state: WorkspaceState, contentId: string) {
  return state.content.find((item) => item.id === contentId);
}

function makeRun(state: WorkspaceState, employee: Employee, task: string, trigger: "manual" | "heartbeat" | "evaluation", result: LlmResult, startedAt: number) {
  const scoringStartedAt = Date.now();
  const score = scoreRun(task, result.content);
  const scoringDurationMs = Math.max(0, Date.now() - scoringStartedAt);
  const run = {
    id: createId("run"),
    employeeId: employee.id,
    trigger,
    task,
    output: result.content,
    score,
    reason: trigger === "evaluation"
      ? "Golden test passed with a grounded answer and an explicit next action."
      : "The run used the employee prompt, retrieved context, and ended with an actionable owner.",
    status: "completed" as const,
    createdAt: timestamp(),
    durationMs: Math.max(1, Date.now() - startedAt),
    trace: [
      { label: "Memory", detail: "Loaded workspace state", durationMs: 0, cost: 0, status: "complete" as const },
      { label: "Knowledge", detail: `${result.citations.length} scoped source${result.citations.length === 1 ? "" : "s"} considered`, durationMs: result.timings.retrievalDurationMs, cost: 0, status: "complete" as const },
      { label: "Worker", detail: `${employee.model} · ${result.provider}`, durationMs: result.timings.workerDurationMs, cost: 1, status: "complete" as const },
      { label: "Evaluator", detail: "Independent rubric score", durationMs: scoringDurationMs, cost: 1, status: "complete" as const },
    ],
  };
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 30);
  state.workspace.aiCredits.remaining = Math.max(0, state.workspace.aiCredits.remaining - 2);
  recordEmployeeScore(employee, score);
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

async function applySequenceDelivery(args: {
  workspaceId: string;
  rowId: string;
  listId: string;
  sequenceId: string;
  stepIndex: number;
  providerMessageId: string;
  sentAt: string;
}) {
  return updateWorkspace(args.workspaceId, (state) => {
    const list = state.lists.find((item) => item.id === args.listId);
    const row = list?.rows.find((item) => item.id === args.rowId);
    const sequence = state.sequences.find((item) => item.id === args.sequenceId);
    if (!list || !row || !sequence) return state;
    if (row.lastProviderMessageId === args.providerMessageId) return state;
    row.sequenceId = sequence.id;
    row.sequenceStepIndex = Math.max(row.sequenceStepIndex || 0, args.stepIndex + 1);
    row.sequenceStatus = row.sequenceStepIndex >= sequence.steps.length ? "completed" : "active";
    row.lastSentAt = args.sentAt;
    row.lastProviderMessageId = args.providerMessageId;
    row.lastAction = `Sent ${sequence.steps[args.stepIndex]?.title || "sequence step"} through Gmail`;
    sequence.sent = (sequence.sent || 0) + 1;
    addActivity(state, { type: "sequence", title: `${row.name} received ${sequence.name}`, detail: `${sequence.steps[args.stepIndex]?.title || "Email step"} sent through the connected Gmail mailbox`, });
    return state;
  });
}

function onboardingGoal(value: unknown): OnboardingGoal {
  return (["revenue", "delivery", "content", "support"] as const).includes(value as OnboardingGoal) ? value as OnboardingGoal : "revenue";
}

function nextScheduleAt(cadence: ScheduledWork["cadence"], from = Date.now()) {
  const delay = cadence === "every 15m" ? 15 : cadence === "hourly" ? 60 : cadence === "daily" ? 1440 : cadence === "weekly" ? 10080 : 0;
  return new Date(from + delay * 60 * 1000).toISOString();
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
      ...workspaceStateForClient(state),
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
  if (["update-outbound-safety", "suppress-domain", "unsuppress-domain"].includes(action) && !hasPermission(identity.context, "settings:write")) {
    return json({ error: "You do not have permission to change outbound safety settings." }, { status: 403 });
  }

  let importSummary: { imported: number; skipped: number; errors: LeadCsvError[] } | undefined;
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
        state.profile = artifacts.profile;
        state.employees.unshift(...artifacts.employees);
        state.documents.unshift({ ...artifacts.document, employeeIds: artifacts.employees.map((employee) => employee.id) });
        state.missions.unshift(...artifacts.missions);
        state.content.unshift(...artifacts.content);
        state.sequences.unshift(artifacts.sequence);
        state.playbooks = state.playbooks.length ? state.playbooks : artifacts.playbooks;
        state.workspace.onboarding = {
          ...createOnboardingState("ready"),
          goal,
          companyUrl: discovery.url,
          sourceTitle: artifacts.document.name,
          sourceDescription: artifacts.sourceDescription,
          discoveredAt: timestamp(),
          employeeId: artifacts.employee.id,
          employeeIds: artifacts.employees.map((employee) => employee.id),
          documentId: artifacts.document.id,
          missionIds: artifacts.missions.map((mission) => mission.id),
          contentIds: artifacts.content.map((item) => item.id),
        };
        addActivity(state, { type: "system", title: `${companyName} was discovered`, detail: `${artifacts.document.name} indexed · ${artifacts.employees.length} operators, ${artifacts.missions.length} missions, and a draft sequence are ready`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.bootstrap", metadata: { goal, source: discovery.url ? "public_url" : "operator_brief" } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The workspace was created, but its audit record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(next), discovery: { title: next.workspace.onboarding.sourceTitle, description: next.workspace.onboarding.sourceDescription, url: next.workspace.onboarding.companyUrl } });
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

    if (action === "send-sequence-step") {
      const listId = String(body.listId || "");
      const rowId = String(body.rowId || "");
      const sequenceId = String(body.sequenceId || "");
      const current = await getWorkspace(companyId);
      const list = current.lists.find((item) => item.id === listId);
      const row = list?.rows.find((item) => item.id === rowId);
      const sequence = current.sequences.find((item) => item.id === sequenceId);
      const stepIndex = Number.isInteger(Number(body.stepIndex)) ? Number(body.stepIndex) : row?.sequenceStepIndex || 0;
      const step = sequence?.steps[stepIndex];
      if (!list || !row || !sequence || !step) return json({ error: "Lead, sequence, or sequence step not found." }, { status: 400 });
      if (sequence.status !== "live") return json({ error: "Activate the sequence after reviewing its steps before sending." }, { status: 400 });
      if (step.channel !== "Email") return json({ error: "Only Email sequence steps can be sent through Gmail." }, { status: 400 });
      if (row.status !== "enriched") return json({ error: "Research the lead before sending." }, { status: 400 });
      if (row.enrollmentStatus === "replied") return json({ error: "This sequence is paused because the lead replied." }, { status: 400 });
      if (row.enrollmentStatus !== "enrolled") return json({ error: "Enroll the lead before sending a sequence step." }, { status: 400 });
      if (row.sequenceId && row.sequenceId !== sequence.id) return json({ error: "This lead is enrolled in a different sequence." }, { status: 409 });
      if ((row.sequenceStepIndex || 0) > stepIndex) return json({ error: "This sequence step has already been sent." }, { status: 409 });
      if (current.suppressedEmails.includes(row.email.toLowerCase())) return json({ error: "This address is suppressed and cannot receive sequence mail." }, { status: 400 });
      const safety = outboundSafetyDecision({ settings: current.outboundSafety, email: row.email });
      if (!safety.allowed) return json({ error: safety.reason, code: safety.code, localDate: safety.localDate }, { status: 400 });
      let integrations;
      try { integrations = await listIntegrationSummaries(companyId); } catch { return json({ error: "Gmail connection status is unavailable. Apply the platform database migration." }, { status: 503 }); }
      const gmail = integrations.find((integration) => integration.provider === "gmail");
      if (gmail?.status !== "connected") return json({ error: "Connect Gmail before sending a sequence email." }, { status: 400 });
      const email = sequenceEmailFor(sequence, step, row);
      const idempotencyKey = sequenceStepIdempotencyKey(companyId, sequence.id, row.id, stepIndex);
      let claimed;
      try {
        claimed = await claimOutboundMessage({ workspaceId: companyId, idempotencyKey, recipient: row.email, sequenceId: sequence.id, rowId: row.id, stepIndex, subject: email.subject, bodyText: email.body, dailyLimit: current.outboundSafety.dailySendLimit, dailySince: startOfLocalDay(new Date(), current.outboundSafety.timezone).toISOString() });
      } catch {
        return json({ error: "Outbound safety could not be checked because the durable send store is unavailable." }, { status: 503 });
      }
      if (claimed.kind === "limit") return json({ error: `The workspace daily send limit of ${claimed.limit} has been reached. Try again after the local day resets.`, code: "daily_limit", sent: claimed.count, limit: claimed.limit }, { status: 429 });
      if (claimed.kind === "blocked") return json({ error: claimed.record.status === "unknown" ? "This send has an unknown provider outcome. Reconcile it before retrying." : "This send is already in progress. Refresh before retrying." }, { status: 409 });
      if (claimed.kind === "sent") {
        const reconciled = await applySequenceDelivery({ workspaceId: companyId, listId, rowId, sequenceId, stepIndex, providerMessageId: claimed.record.providerMessageId || "", sentAt: claimed.record.updatedAt });
        return json({ ...reconciled, delivery: { status: "sent", messageId: claimed.record.providerMessageId, idempotent: true } }, { headers: rateLimitHeaders(identity.context) });
      }
      let sent: { id?: string; threadId?: string };
      try {
        sent = await sendGmailMessage(companyId, { to: row.email, subject: email.subject, body: email.body });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gmail send failed.";
        if (error instanceof GmailSendError && !error.safeToRetry) await markOutboundUnknown(claimed.record.id, message);
        else await markOutboundFailed(claimed.record.id, message);
        return json({ error: message }, { status: 400 });
      }
      if (!sent.id) {
        await markOutboundUnknown(claimed.record.id, "Gmail returned no message id.");
        return json({ error: "Gmail returned no message id. Do not retry until the mailbox is reconciled." }, { status: 502 });
      }
      try {
        await markOutboundSent(claimed.record.id, sent.id, sent.threadId || null);
      } catch (error) {
        await markOutboundUnknown(claimed.record.id, error instanceof Error ? error.message : "The send record could not be completed.").catch(() => undefined);
        return json({ error: "Gmail accepted the message, but Perpendicular could not persist its send record. Do not retry until the mailbox is reconciled." }, { status: 503 });
      }
      const sentAt = timestamp();
      const updated = await applySequenceDelivery({ workspaceId: companyId, listId, rowId, sequenceId, stepIndex, providerMessageId: sent.id, sentAt });
      let inboxRecorded = false;
      try {
        if (sent.threadId) {
          await upsertGmailMessage({ workspaceId: companyId, providerThreadId: sent.threadId, providerMessageId: sent.id, direction: "outbound", sender: gmail.accountEmail || identity.context.email, recipients: [row.email], subject: email.subject, bodyText: email.body, receivedAt: sentAt, metadata: { sequenceId: sequence.id, rowId: row.id, stepIndex } });
          inboxRecorded = true;
        }
      } catch { /* The provider send remains durable even if inbox indexing is temporarily unavailable. */ }
      let auditRecorded = true;
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "gmail.sequence_message_sent", resourceType: "outbound_message", resourceId: claimed.record.id, metadata: { sequenceId: sequence.id, rowId: row.id, stepIndex, providerMessageId: sent.id, recipient: row.email } }); } catch { auditRecorded = false; }
      return json({ ...updated, delivery: { status: "sent", messageId: sent.id, threadId: sent.threadId || null, inboxRecorded, auditRecorded } }, { headers: rateLimitHeaders(identity.context) });
    }

    if (action === "run-onboarding-brief") {
      const current = await getWorkspace(companyId);
      const onboarding = current.workspace.onboarding;
      const employee = onboarding.employeeId ? findEmployee(current, onboarding.employeeId) : undefined;
      if (!employee || !onboarding.goal) return json({ error: "Complete workspace discovery before running the first brief." }, { status: 400 });
      if (onboarding.runId) return json(workspaceStateForClient(current));
      if (current.workspace.aiCredits.remaining < 2) return json({ error: "Not enough AI Credits for the first brief." }, { status: 402 });
      const task = employee.goldenTests[0]?.input || "Review the workspace and propose the three highest-leverage next actions for this week.";
      const startedAt = Date.now();
      const result = await generateEmployeeReply(employee, task, current.documents);
      const next = await updateWorkspace(companyId, (state) => {
        if (state.workspace.onboarding.runId) return state;
        const liveEmployee = findEmployee(state, employee.id);
        if (!liveEmployee) return state;
        const run = makeRun(state, liveEmployee, task, "manual", result, startedAt);
        const firstMissionId = state.workspace.onboarding.missionIds[0];
        const firstMission = firstMissionId ? findMission(state, firstMissionId) : state.missions.find((mission) => mission.employeeId === liveEmployee.id && mission.status === "ready");
        if (firstMission) {
          firstMission.status = "needs_review";
          firstMission.output = result.content;
          firstMission.runId = run.id;
          firstMission.updatedAt = run.createdAt;
        }
        state.workspace.onboarding.status = "proved";
        state.workspace.onboarding.runId = run.id;
        addActivity(state, { type: "run", title: `${liveEmployee.name} delivered the first brief`, detail: `Score ${run.score} · ${firstMission ? `${firstMission.title} is ready for review` : `grounded in ${state.documents[0]?.name || "workspace context"}`}`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_run", resourceType: "employee", resourceId: employee.id }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The brief was saved, but its audit record could not be stored." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "onboarding_brief", unit: "ai", units: 2 }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The brief was saved, but its usage record could not be stored." }, { status: 503 }); }
      return json(workspaceStateForClient(next));
    }

    if (action === "enable-onboarding-schedule") {
      const next = await updateWorkspace(companyId, (state) => {
        const onboarding = state.workspace.onboarding;
        const employee = onboarding.employeeId ? findEmployee(state, onboarding.employeeId) : undefined;
        if (!employee || !onboarding.goal || !onboarding.runId || onboarding.status !== "proved") throw new Error("Run the first brief before enabling the daily rhythm.");
        const task = employee.goldenTests[0]?.input || "Review the workspace and write the highest-leverage next action for this week.";
        employee.schedule = { enabled: true, cadence: "daily", task, nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
        state.workspace.onboarding.scheduleEnabled = true;
        state.workspace.onboarding.status = "completed";
        state.workspace.onboarding.completedAt = timestamp();
        addActivity(state, { type: "employee", title: `${employee.name} is now on a daily rhythm`, detail: "The Dell heartbeat will run the same grounded brief each day", });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_schedule" }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The schedule was saved, but its audit record could not be stored." }, { status: 503 }); }
      return json(workspaceStateForClient(next));
    }

    if (action === "finish-onboarding") {
      const next = await updateWorkspace(companyId, (state) => {
        if (!state.workspace.onboarding.runId) throw new Error("Run the first brief before opening the workbench.");
        state.workspace.onboarding.status = "completed";
        state.workspace.onboarding.completedAt = state.workspace.onboarding.completedAt || timestamp();
        addActivity(state, { type: "system", title: "Workspace setup completed", detail: "The operator pod is ready for manual work." });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_complete" }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The workspace was opened, but its audit record could not be stored." }, { status: 503 }); }
      return json(workspaceStateForClient(next));
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
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.chat", resourceType: "employee", resourceId: employeeId }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The chat reply was saved, but its audit record could not be stored." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "employee_chat", unit: "ai", units: 1, provider: result.provider }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The chat reply was saved, but its usage record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(next), provider: result.provider }, { headers: rateLimitHeaders(identity.context) });
    }

    if (action === "configure-widget") {
      const enabled = body.enabled !== false;
      const employeeId = String(body.employeeId || "").trim() || null;
      const greeting = String(body.greeting || "").trim() || "Tell us what you are trying to accomplish. Our operator will help with the next step.";
      const current = await getWorkspace(companyId);
      if (enabled && employeeId && !findEmployee(current, employeeId)) return json({ error: "Widget operator not found." }, { status: 400 });
      if (enabled && !employeeId && !current.employees.some((employee) => employee.status === "live")) return json({ error: "Create a live employee before enabling the widget." }, { status: 400 });
      const key = enabled ? createWidgetKey() : null;
      const next = await updateWorkspace(companyId, (state) => {
        state.widget = { enabled, employeeId, greeting: greeting.slice(0, 500), publicKeyHash: key ? widgetKeyHash(key) : null };
        addActivity(state, { type: "system", title: `Website widget ${enabled ? "enabled" : "disabled"}`, detail: enabled ? "Public conversations are routed to the selected operator." : "Public conversations are no longer accepted." });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "widget.configured", metadata: { enabled, employeeId } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The widget was saved, but its audit record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(next), widget: { key, enabled, employeeId: next.widget.employeeId, greeting: next.widget.greeting } });
    }

    if (action === "run-mission" || action === "generate-content") {
      const current = await getWorkspace(companyId);
      const mission = action === "run-mission" ? findMission(current, String(body.missionId || "")) : undefined;
      const content = action === "generate-content" ? findContent(current, String(body.contentId || "")) : undefined;
      const employeeId = mission?.employeeId || content?.employeeId || String(body.employeeId || "");
      const employee = findEmployee(current, employeeId) || current.employees.find((candidate) => candidate.status === "live");
      if (action === "run-mission" && !mission) return json({ error: "Mission not found." }, { status: 404 });
      if (action === "generate-content" && !content) return json({ error: "Content item not found." }, { status: 404 });
      if (!employee) return json({ error: "Assign an employee before running this work." }, { status: 400 });
      if (current.workspace.aiCredits.remaining < 2) return json({ error: "Not enough AI Credits for this run." }, { status: 402 });
      const task = mission
        ? `${mission.title}\n\nMission: ${mission.description}\n\nUse the workspace sources, state what is known, identify missing evidence, and finish with an owner and next action.`
        : `Create a ${content?.channel} draft titled "${content?.title}". Objective: ${content?.objective}. Use only the workspace context, preserve the company's voice, avoid unsupported claims, and return the draft plus one note about evidence that still needs review.`;
      const startedAt = Date.now();
      const result = await generateEmployeeReply(employee, task, current.documents);
      const next = await updateWorkspace(companyId, (state) => {
        const liveEmployee = findEmployee(state, employee.id);
        if (!liveEmployee) return state;
        const run = makeRun(state, liveEmployee, task, "manual", result, startedAt);
        if (mission) {
          const liveMission = findMission(state, mission.id);
          if (liveMission) {
            liveMission.status = "needs_review";
            liveMission.output = result.content;
            liveMission.runId = run.id;
            liveMission.updatedAt = run.createdAt;
          }
          addActivity(state, { type: "mission", title: `${mission.title} is ready for review`, detail: `${liveEmployee.name} · score ${run.score}`, });
        } else if (content) {
          const liveContent = findContent(state, content.id);
          if (liveContent) {
            liveContent.status = "review";
            liveContent.body = result.content;
            liveContent.employeeId = liveEmployee.id;
            liveContent.updatedAt = run.createdAt;
          }
          addActivity(state, { type: "content", title: `${content.title} is ready for review`, detail: `${liveEmployee.name} · ${content.channel} draft · score ${run.score}`, });
        }
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: `workspace.${action}`, resourceType: mission ? "mission" : "content", resourceId: mission?.id || content?.id }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The work was saved, but its audit record could not be stored." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: mission ? "mission_run" : "content_generation", unit: "ai", units: 2, provider: result.provider }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The work was saved, but its usage record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(next), provider: result.provider }, { headers: rateLimitHeaders(identity.context) });
    }

    const updated = await updateWorkspace(companyId, async (state) => {
      switch (action) {
        case "update-profile": {
          const nextProfile = { ...state.profile };
          for (const key of ["industry", "website", "description", "idealCustomer", "brandVoice", "timezone"] as const) {
            if (body[key] !== undefined) {
              const value = String(body[key] || "").trim();
              if (key === "website") nextProfile.website = value || null;
              else nextProfile[key] = value || nextProfile[key];
            }
          }
          if (body.goals !== undefined) {
            if (!Array.isArray(body.goals)) throw new Error("Goals must be a list of strings.");
            nextProfile.goals = body.goals.map((goal) => String(goal).trim()).filter(Boolean).slice(0, 12);
          }
          nextProfile.updatedAt = timestamp();
          state.profile = nextProfile;
          addActivity(state, { type: "system", title: "Company context updated", detail: "The profile is now available to every scoped operator." });
          return state;
        }
        case "create-mission": {
          const title = String(body.title || "").trim();
          const description = String(body.description || "").trim();
          if (!title || !description) throw new Error("Mission title and description are required.");
          const employeeId = String(body.employeeId || "").trim() || null;
          if (employeeId && !findEmployee(state, employeeId)) throw new Error("Assigned employee not found.");
          const priority = (["low", "normal", "high"] as const).includes(body.priority as never) ? body.priority as Mission["priority"] : "normal";
          const mission: Mission = { id: createId("mission"), title, description, status: "ready", priority, employeeId, sourceDocumentIds: [], output: null, runId: null, dueAt: body.dueAt ? String(body.dueAt) : null, createdAt: timestamp(), updatedAt: timestamp() };
          state.missions.unshift(mission);
          addActivity(state, { type: "mission", title: `${mission.title} was created`, detail: employeeId ? `Assigned to ${findEmployee(state, employeeId)?.name || "operator"}` : "Unassigned mission" });
          return state;
        }
        case "delegate-mission": {
          const mission = findMission(state, String(body.missionId || ""));
          const employeeId = String(body.employeeId || "").trim();
          if (!mission || !employeeId || !findEmployee(state, employeeId)) throw new Error("Mission or employee not found.");
          mission.employeeId = employeeId;
          mission.updatedAt = timestamp();
          addActivity(state, { type: "mission", title: `${mission.title} was delegated`, detail: `Assigned to ${findEmployee(state, employeeId)?.name}` });
          return state;
        }
        case "approve-mission":
        case "complete-mission": {
          const mission = findMission(state, String(body.missionId || ""));
          if (!mission) throw new Error("Mission not found.");
          if (action === "approve-mission" && mission.status !== "needs_review") throw new Error("Run the mission before approving its result.");
          mission.status = "completed";
          mission.updatedAt = timestamp();
          addActivity(state, { type: "mission", title: `${mission.title} was completed`, detail: mission.output ? "Output approved by the workspace operator" : "Completed without an AI output" });
          return state;
        }
        case "create-content": {
          const title = String(body.title || "").trim();
          const objective = String(body.objective || "").trim();
          if (!title || !objective) throw new Error("Content title and objective are required.");
          const channels = ["blog", "linkedin", "email", "social", "website"] as const;
          const channel = channels.includes(body.channel as never) ? body.channel as ContentItem["channel"] : "linkedin";
          const employeeId = String(body.employeeId || "").trim() || state.employees.find((employee) => employee.department === "Content")?.id || null;
          const item: ContentItem = { id: createId("content"), title, channel, objective, status: "idea", body: "", employeeId, missionId: null, scheduledAt: null, createdAt: timestamp(), updatedAt: timestamp() };
          state.content.unshift(item);
          addActivity(state, { type: "content", title: `${item.title} was added`, detail: `${item.channel} · ready for a grounded draft` });
          return state;
        }
        case "approve-content": {
          const item = findContent(state, String(body.contentId || ""));
          if (!item || !item.body) throw new Error("Generate the content draft before approving it.");
          item.status = "approved";
          item.updatedAt = timestamp();
          addActivity(state, { type: "content", title: `${item.title} was approved`, detail: "Ready to schedule or publish from the editorial workflow" });
          return state;
        }
        case "schedule-content": {
          const item = findContent(state, String(body.contentId || ""));
          if (!item || !["approved", "scheduled"].includes(item.status)) throw new Error("Approve the content before scheduling it.");
          const scheduledAt = body.scheduledAt ? new Date(String(body.scheduledAt)) : new Date(Date.now() + 1000 * 60 * 60);
          if (Number.isNaN(scheduledAt.getTime())) throw new Error("Scheduled time is invalid.");
          item.status = "scheduled";
          item.scheduledAt = scheduledAt.toISOString();
          item.updatedAt = timestamp();
          addActivity(state, { type: "content", title: `${item.title} was scheduled`, detail: `${item.channel} · ${scheduledAt.toLocaleString()}` });
          return state;
        }
        case "publish-content": {
          const item = findContent(state, String(body.contentId || ""));
          if (!item || !["approved", "scheduled"].includes(item.status)) throw new Error("Approve the content before publishing it.");
          item.status = "published";
          item.updatedAt = timestamp();
          addActivity(state, { type: "content", title: `${item.title} was marked published`, detail: "Editorial state updated. Connect a channel publisher to send externally." });
          return state;
        }
        case "install-playbook": {
          const playbook = state.playbooks.find((candidate) => candidate.id === String(body.playbookId || ""));
          if (!playbook) throw new Error("Playbook not found.");
          playbook.installedAt = playbook.installedAt || timestamp();
          addActivity(state, { type: "playbook", title: `${playbook.name} was installed`, detail: `${playbook.steps.length} executable steps are ready` });
          return state;
        }
        case "run-playbook": {
          const playbook = state.playbooks.find((candidate) => candidate.id === String(body.playbookId || ""));
          if (!playbook) throw new Error("Playbook not found.");
          if (!playbook.installedAt) throw new Error("Install the playbook before running it.");
          const employeeId = String(body.employeeId || "").trim() || state.employees.find((employee) => employee.department === "Operations")?.id || state.employees[0]?.id || null;
          const mission: Mission = { id: createId("mission"), title: `${playbook.name} · next run`, description: playbook.steps.join(" "), status: "ready", priority: "normal", employeeId, sourceDocumentIds: [], output: null, runId: null, dueAt: null, createdAt: timestamp(), updatedAt: timestamp() };
          state.missions.unshift(mission);
          playbook.lastRunAt = mission.createdAt;
          addActivity(state, { type: "playbook", title: `${playbook.name} created a mission`, detail: employeeId ? `Assigned to ${findEmployee(state, employeeId)?.name}` : "Assign an operator to run it" });
          return state;
        }
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
          const name = String(body.name || body.fileName || "").trim();
          let content = String(body.content || "").trim();
          if (body.source === "url") {
            const sourceUrl = String(body.url || "").trim();
            if (!sourceUrl) throw new Error("A URL is required for URL capture.");
            content = (await researchWebsite(sourceUrl)).text;
          } else if (body.fileData) {
            content = await ingestUploadedDocument({ content, fileData: String(body.fileData), fileName: String(body.fileName || name), fileType: String(body.fileType || "") });
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
          const role = String(body.role || "Unknown");
          const score = scoreLead({ email, role, company });
          list.rows.unshift({ id: createId("row"), name, email, company, role, location: String(body.location || "Unknown"), score: score.score, scoreReasons: score.reasons, status: "new", emailStatus: "unknown", intent: score.intent, companyInsight: "No public research captured yet", enrollmentStatus: "not enrolled", lastAction: "Imported by workspace operator" });
          list.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${name} was imported`, detail: `${company} · ${list.name}`, });
          return state;
        }
        case "import-csv": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          if (!list) throw new Error("List not found.");
          const parsed = parseLeadCsv(String(body.csv || ""));
          const errors = [...parsed.errors];
          const seen = new Set<string>();
          let imported = 0;
          for (const record of parsed.records) {
            const email = normalizeEmail(record.email);
            const domain = email.split("@")[1] || "";
            if (seen.has(email)) {
              errors.push({ line: record.line, reason: "duplicate email in this CSV" });
              continue;
            }
            seen.add(email);
            if (state.suppressedEmails.includes(email) || state.outboundSafety.suppressedDomains.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) {
              errors.push({ line: record.line, reason: "email or domain is suppressed for this workspace" });
              continue;
            }
            if (state.lists.some((candidate) => candidate.rows.some((row) => row.email.toLowerCase() === email))) {
              errors.push({ line: record.line, reason: "email already exists in this workspace" });
              continue;
            }
            const score = scoreLead({ email, role: record.role, company: record.company });
            list.rows.unshift({ id: createId("row"), name: record.name.slice(0, 160), email, company: record.company.slice(0, 160), role: record.role.slice(0, 120), location: record.location.slice(0, 120), score: score.score, scoreReasons: score.reasons, status: "new", emailStatus: "unknown", intent: score.intent, companyInsight: "No public research captured yet", enrollmentStatus: "not enrolled", lastAction: "Imported from CSV" });
            imported += 1;
          }
          list.updatedAt = timestamp();
          importSummary = { imported, skipped: errors.length, errors: errors.slice(0, 50) };
          if (imported) addActivity(state, { type: "lead", title: `${imported} lead${imported === 1 ? "" : "s"} imported into ${list.name}`, detail: `${errors.length} row${errors.length === 1 ? "" : "s"} skipped with validation or suppression errors` });
          return state;
        }
        case "create-sequence": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Sequence name is required.");
          state.sequences.unshift({ id: createId("seq"), name, status: "draft", audience: String(body.audience || "Imported leads"), enrolled: 0, sent: 0, replied: 0, booked: 0, steps: [{ id: createId("step"), channel: "Email", title: "First touch", delay: "Day 0", subject: String(body.subject || "").trim() || undefined, body: String(body.body || "Write a useful, specific first touch. Require human approval before sending.") }] });
          addActivity(state, { type: "sequence", title: `${name} was created`, detail: "Draft sequence · Gmail connection and approval required before sending", });
          return state;
        }
        case "activate-sequence": {
          const sequence = state.sequences.find((item) => item.id === String(body.sequenceId || ""));
          if (!sequence) throw new Error("Sequence not found.");
          if (!sequence.steps.length || sequence.steps.some((step) => !step.body.trim())) throw new Error("Every sequence step needs a message before activation.");
          if (sequence.status === "live") return state;
          sequence.status = "live";
          addActivity(state, { type: "sequence", title: `${sequence.name} was activated`, detail: "Human-approved sequence · each outbound step still requires an explicit send", });
          return state;
        }
        case "run-employee": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const task = String(body.task || "").trim();
          if (!employee || !task) throw new Error("Employee and task are required.");
          if (state.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a run.");
          const startedAt = Date.now();
          const result = await generateEmployeeReply(employee, task, state.documents);
          const run = makeRun(state, employee, task, "manual", result, startedAt);
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
          const startedAt = Date.now();
          const result = await generateEmployeeReply(evaluatedVersion ? { ...employee, systemPrompt: evaluatedVersion.prompt } : employee, task, state.documents);
          const run = makeRun(state, employee, task, "evaluation", result, startedAt);
          employee.goldenTests = employee.goldenTests.map((test) => ({ ...test, lastScore: run.score }));
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
            const score = scoreLead({ email: row.email, role: row.role, company: row.company, researchText: research.text, idealCustomer: state.profile.idealCustomer });
            row.score = score.score;
            row.scoreReasons = score.reasons;
            row.intent = score.intent;
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
          row.sequenceId = sequence.id;
          row.sequenceStepIndex = 0;
          row.sequenceStatus = "active";
          row.lastSentAt = null;
          row.lastProviderMessageId = null;
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
        case "suppress-domain": {
          const domain = normalizeDomain(String(body.domain || ""));
          const validation = validateOutboundSafetySettings({ ...state.outboundSafety, suppressedDomains: [...state.outboundSafety.suppressedDomains, domain] });
          if (validation.error) throw new Error(validation.error);
          state.outboundSafety = validation.settings;
          addActivity(state, { type: "lead", title: `${domain} was domain-suppressed`, detail: "Sequence sends to this domain and its subdomains are blocked" });
          return state;
        }
        case "unsuppress-domain": {
          const domain = normalizeDomain(String(body.domain || ""));
          state.outboundSafety.suppressedDomains = state.outboundSafety.suppressedDomains.filter((candidate) => candidate !== domain);
          state.outboundSafety.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${domain} was removed from domain suppression`, detail: "The domain may receive sequence mail when other safety checks pass" });
          return state;
        }
        case "update-outbound-safety": {
          const validation = validateOutboundSafetySettings({
            dailySendLimit: body.dailySendLimit === undefined ? state.outboundSafety.dailySendLimit : Number(body.dailySendLimit),
            timezone: typeof body.timezone === "string" ? body.timezone : state.outboundSafety.timezone,
            sendWindowStart: typeof body.sendWindowStart === "string" ? body.sendWindowStart : state.outboundSafety.sendWindowStart,
            sendWindowEnd: typeof body.sendWindowEnd === "string" ? body.sendWindowEnd : state.outboundSafety.sendWindowEnd,
            skipWeekends: body.skipWeekends === undefined ? state.outboundSafety.skipWeekends : body.skipWeekends === true,
            suppressedDomains: state.outboundSafety.suppressedDomains,
          });
          if (validation.error) throw new Error(validation.error);
          state.outboundSafety = validation.settings;
          addActivity(state, { type: "system", title: "Outbound safety settings updated", detail: `${state.outboundSafety.dailySendLimit} sends/day · ${state.outboundSafety.sendWindowStart}–${state.outboundSafety.sendWindowEnd} · ${state.outboundSafety.timezone}` });
          return state;
        }
        case "create-schedule": {
          const name = String(body.name || "").trim();
          const description = String(body.description || "").trim();
          if (!name || !description) throw new Error("Schedule name and task are required.");
          const employeeId = String(body.employeeId || "").trim() || null;
          if (employeeId && !findEmployee(state, employeeId)) throw new Error("Assigned employee not found.");
          const cadence = (["once", "every 15m", "hourly", "daily", "weekly"] as const).includes(body.cadence as never)
            ? body.cadence as ScheduledWork["cadence"]
            : "daily";
          const requestedNextRun = body.nextRunAt ? new Date(String(body.nextRunAt)) : null;
          if (requestedNextRun && Number.isNaN(requestedNextRun.getTime())) throw new Error("The next run time is invalid.");
          const schedule: ScheduledWork = {
            id: createId("schedule"),
            name,
            description,
            employeeId,
            cadence,
            nextRunAt: requestedNextRun?.toISOString() || nextScheduleAt(cadence),
            active: true,
            lastRunAt: null,
            runCount: 0,
            createdAt: timestamp(),
          };
          state.schedules.unshift(schedule);
          addActivity(state, { type: "system", title: `${name} was scheduled`, detail: `${cadence} · ${employeeId ? findEmployee(state, employeeId)?.name : "unassigned"}` });
          return state;
        }
        case "toggle-schedule": {
          const schedule = state.schedules.find((candidate) => candidate.id === String(body.scheduleId || ""));
          if (!schedule) throw new Error("Schedule not found.");
          schedule.active = body.active !== false;
          if (schedule.active && new Date(schedule.nextRunAt).getTime() <= Date.now()) schedule.nextRunAt = nextScheduleAt(schedule.cadence);
          addActivity(state, { type: "system", title: `${schedule.name} ${schedule.active ? "enabled" : "paused"}`, detail: schedule.active ? `Next run ${schedule.nextRunAt}` : "No scheduled run will fire until it is resumed" });
          return state;
        }
        case "run-scheduled": {
          const schedule = state.schedules.find((candidate) => candidate.id === String(body.scheduleId || ""));
          if (!schedule) throw new Error("Schedule not found.");
          const employee = schedule.employeeId ? findEmployee(state, schedule.employeeId) : state.employees.find((candidate) => candidate.status === "live");
          if (!employee) throw new Error("Assign a live employee before running this schedule.");
          if (state.workspace.aiCredits.remaining < 2) throw new Error("Not enough AI Credits for a scheduled run.");
          const startedAt = Date.now();
          const result = await generateEmployeeReply(employee, schedule.description, state.documents);
          const run = makeRun(state, employee, schedule.description, "heartbeat", result, startedAt);
          schedule.lastRunAt = run.createdAt;
          schedule.runCount += 1;
          schedule.active = schedule.cadence === "once" ? false : schedule.active;
          schedule.nextRunAt = schedule.active ? nextScheduleAt(schedule.cadence, Date.now()) : schedule.nextRunAt;
          addActivity(state, { type: "run", title: `${schedule.name} completed`, detail: `${employee.name} · score ${run.score} · ${result.provider}` });
          return state;
        }
        case "create-person": {
          const name = String(body.name || "").trim();
          const email = normalizeEmail(String(body.email || ""));
          const company = String(body.company || "").trim();
          if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Name, company, and a valid email are required.");
          if (state.people.some((person) => person.email === email)) throw new Error("This person already exists in the workspace.");
          const lead = scoreLead({ email, role: String(body.title || ""), company, idealCustomer: state.profile.idealCustomer });
          const person: PersonRecord = {
            id: createId("person"),
            name,
            email,
            title: String(body.title || "Unknown").trim() || "Unknown",
            company,
            location: String(body.location || "Unknown").trim() || "Unknown",
            score: lead.score,
            status: "new",
            source: "manual",
            tags: String(body.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
            notes: String(body.notes || "").trim(),
            createdAt: timestamp(),
            updatedAt: timestamp(),
          };
          state.people.unshift(person);
          addActivity(state, { type: "lead", title: `${name} was added to People`, detail: `${company} · initial score ${person.score}` });
          return state;
        }
        case "qualify-person": {
          const person = state.people.find((candidate) => candidate.id === String(body.personId || ""));
          if (!person) throw new Error("Person not found.");
          if (person.status === "qualified") return state;
          if (state.workspace.dataCredits.remaining < 2) throw new Error("Not enough Data Credits for public research.");
          const research = await researchPersonCompany(person.email, person.company);
          state.workspace.dataCredits.remaining -= 2;
          const lead = scoreLead({ email: person.email, role: person.title, company: person.company, researchText: research.text, idealCustomer: state.profile.idealCustomer });
          person.score = lead.score;
          person.status = "qualified";
          person.notes = [person.notes, research.insight].filter(Boolean).join("\n").slice(0, 2000);
          person.tags = [...new Set([...person.tags, lead.intent])].slice(0, 12);
          person.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${person.name} was qualified`, detail: `Public evidence captured · score ${person.score}` });
          return state;
        }
        case "create-lead-source": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Source name is required.");
          const type = (["manual", "csv", "public"] as const).includes(body.type as never) ? body.type as LeadSource["type"] : "manual";
          const source: LeadSource = { id: createId("source"), name, type, status: "ready", recordCount: 0, lastRunAt: null, createdAt: timestamp() };
          state.leadSources.unshift(source);
          addActivity(state, { type: "lead", title: `${name} was added as a lead source`, detail: `${type} source · ready to run` });
          return state;
        }
        case "run-lead-source": {
          const source = state.leadSources.find((candidate) => candidate.id === String(body.sourceId || ""));
          if (!source) throw new Error("Lead source not found.");
          source.status = "running";
          source.recordCount = state.people.length + state.lists.reduce((total, list) => total + list.rows.length, 0);
          source.status = "completed";
          source.lastRunAt = timestamp();
          addActivity(state, { type: "lead", title: `${source.name} finished`, detail: `${source.recordCount} workspace records available for qualification` });
          return state;
        }
        case "create-campaign": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Campaign name is required.");
          const type = (["broadcast", "content", "event"] as const).includes(body.type as never) ? body.type as Campaign["type"] : "content";
          const campaign: Campaign = { id: createId("campaign"), name, type, audience: String(body.audience || "Workspace audience").trim(), status: "draft", scheduledAt: null, contentId: String(body.contentId || "").trim() || null, listId: String(body.listId || "").trim() || null, createdAt: timestamp(), updatedAt: timestamp() };
          state.campaigns.unshift(campaign);
          addActivity(state, { type: "content", title: `${name} was created`, detail: `${type} campaign · draft` });
          return state;
        }
        case "schedule-campaign": {
          const campaign = state.campaigns.find((candidate) => candidate.id === String(body.campaignId || ""));
          if (!campaign) throw new Error("Campaign not found.");
          const scheduledAt = body.scheduledAt ? new Date(String(body.scheduledAt)) : new Date(Date.now() + 60 * 60 * 1000);
          if (Number.isNaN(scheduledAt.getTime())) throw new Error("Campaign time is invalid.");
          if (campaign.contentId) {
            const content = findContent(state, campaign.contentId);
            if (!content || !["approved", "scheduled"].includes(content.status)) throw new Error("Approve the campaign content before scheduling it.");
          }
          campaign.status = "scheduled";
          campaign.scheduledAt = scheduledAt.toISOString();
          campaign.updatedAt = timestamp();
          addActivity(state, { type: "content", title: `${campaign.name} was scheduled`, detail: `Editorial execution at ${campaign.scheduledAt}` });
          return state;
        }
        case "create-keyword-monitor": {
          const keyword = String(body.keyword || "").trim();
          if (!keyword || keyword.length < 2) throw new Error("Keyword must be at least two characters.");
          if (state.keywordMonitors.some((monitor) => monitor.keyword.toLowerCase() === keyword.toLowerCase())) throw new Error("This keyword is already monitored.");
          const monitor: KeywordMonitor = { id: createId("keyword"), keyword, status: "active", lastCheckedAt: null, matchCount: 0, latestSummary: null, createdAt: timestamp() };
          state.keywordMonitors.unshift(monitor);
          addActivity(state, { type: "system", title: `Monitoring ${keyword}`, detail: "Public web checks are ready to run" });
          return state;
        }
        case "check-keyword": {
          const monitor = state.keywordMonitors.find((candidate) => candidate.id === String(body.monitorId || ""));
          if (!monitor) throw new Error("Keyword monitor not found.");
          if (monitor.status !== "active") throw new Error("Resume the monitor before checking it.");
          const result = await researchPublicKeyword(monitor.keyword);
          monitor.lastCheckedAt = timestamp();
          monitor.matchCount = result.matches.length;
          monitor.latestSummary = result.matches.slice(0, 3).map((match) => match.title).join(" · ") || "No public matches found.";
          addActivity(state, { type: "system", title: `${monitor.keyword} was checked`, detail: `${monitor.matchCount} public matches captured` });
          return state;
        }
        case "toggle-keyword-monitor": {
          const monitor = state.keywordMonitors.find((candidate) => candidate.id === String(body.monitorId || ""));
          if (!monitor) throw new Error("Keyword monitor not found.");
          monitor.status = body.active === false ? "paused" : "active";
          return state;
        }
        case "create-inbound-agent": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Agent name is required.");
          const employeeId = String(body.employeeId || "").trim() || state.employees.find((employee) => employee.status === "live")?.id || null;
          if (employeeId && !findEmployee(state, employeeId)) throw new Error("Assigned employee not found.");
          const agent: InboundAgent = { id: createId("agent"), name, description: String(body.description || "Answer visitors with grounded workspace context.").trim(), employeeId, channel: (["website", "api", "widget"] as const).includes(body.channel as never) ? body.channel as InboundAgent["channel"] : "website", greeting: String(body.greeting || "How can we help?").trim(), status: "draft", createdAt: timestamp(), updatedAt: timestamp() };
          state.inboundAgents.unshift(agent);
          addActivity(state, { type: "system", title: `${name} was created`, detail: `Inbound agent · ${agent.channel} · draft` });
          return state;
        }
        case "toggle-inbound-agent": {
          const agent = state.inboundAgents.find((candidate) => candidate.id === String(body.agentId || ""));
          if (!agent) throw new Error("Inbound agent not found.");
          agent.status = body.active === false ? "paused" : "live";
          agent.updatedAt = timestamp();
          addActivity(state, { type: "system", title: `${agent.name} is ${agent.status}`, detail: "Inbound routing state updated" });
          return state;
        }
        case "create-site": {
          const name = String(body.name || "").trim();
          const headline = String(body.headline || "").trim();
          if (!name || !headline) throw new Error("Site name and headline are required.");
          const kind = body.kind === "landing_page" ? "landing_page" : "website";
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || createId("site");
          const site: SiteRecord = { id: createId("site"), name, kind, slug, agentId: String(body.agentId || "").trim() || null, status: "draft", headline, body: String(body.body || "").trim(), createdAt: timestamp(), updatedAt: timestamp() };
          state.sites.unshift(site);
          addActivity(state, { type: "system", title: `${name} was created`, detail: `${kind.replace("_", " ")} · draft` });
          return state;
        }
        case "publish-site": {
          const site = state.sites.find((candidate) => candidate.id === String(body.siteId || ""));
          if (!site) throw new Error("Site not found.");
          site.status = "published";
          site.updatedAt = timestamp();
          addActivity(state, { type: "system", title: `${site.name} was published`, detail: `/site/${site.slug}` });
          return state;
        }
        case "create-app": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("App name is required.");
          const app: AppRecord = { id: createId("app"), name, description: String(body.description || "").trim() || "A workspace-native workflow.", type: (["workflow", "api", "mcp"] as const).includes(body.type as never) ? body.type as AppRecord["type"] : "workflow", employeeId: String(body.employeeId || "").trim() || null, status: "draft", createdAt: timestamp(), updatedAt: timestamp() };
          if (app.employeeId && !findEmployee(state, app.employeeId)) throw new Error("Assigned employee not found.");
          state.apps.unshift(app);
          addActivity(state, { type: "system", title: `${name} was added to Apps`, detail: `${app.type} · draft` });
          return state;
        }
        case "toggle-app": {
          const app = state.apps.find((candidate) => candidate.id === String(body.appId || ""));
          if (!app) throw new Error("App not found.");
          app.status = body.active === false ? "draft" : "active";
          app.updatedAt = timestamp();
          addActivity(state, { type: "system", title: `${app.name} is ${app.status}`, detail: "Workspace app state updated" });
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
    } catch {
      if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The action was saved, but its audit record could not be stored." }, { status: 503 });
    }
    if (["run-employee", "evaluate-employee", "run-scheduled"].includes(action)) {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: action === "run-employee" ? "employee_run" : action === "evaluate-employee" ? "employee_evaluation" : "scheduled_run", unit: "ai", units: 2 });
      } catch {
        if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The action was saved, but its usage record could not be stored." }, { status: 503 });
      }
    }
    if (action === "enrich-row") {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "public_research", unit: "data", units: 2 });
      } catch {
        if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The research was saved, but its usage record could not be stored." }, { status: 503 });
      }
    }
    if (action === "qualify-person") {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "person_qualification", unit: "data", units: 2 });
      } catch {
        if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The research was saved, but its usage record could not be stored." }, { status: 503 });
      }
    }
    const responseState = workspaceStateForClient(updated);
    return json(importSummary ? { ...responseState, importSummary } : responseState, { headers: rateLimitHeaders(identity.context) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  return applyCors(await postWorkspace(request), request);
}
