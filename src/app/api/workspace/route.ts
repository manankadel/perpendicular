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
  type SmartListAction,
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
import { buildSequenceSteps, sequenceEmailFor, sequenceRequiresGmail, sequenceStepIdempotencyKey } from "@/lib/sequence";
import { ingestUploadedDocument } from "@/lib/document-ingest";
import { researchPersonCompany, researchPublicKeyword, researchWebsite } from "@/lib/public-research";
import { corsHeadersFor } from "@/lib/cors";
import { recordUsage } from "@/lib/usage";
import { createWidgetKey, widgetKeyHash } from "@/lib/widget";
import { workspaceStateForClient } from "@/lib/workspace-view";
import { normalizeDomain, normalizeEmail, outboundSafetyDecision, startOfLocalDay, validateOutboundSafetySettings } from "@/lib/outbound-safety";
import { parseLeadCsv, type LeadCsvError } from "@/lib/lead-csv";
import { scoreLead } from "@/lib/lead-scoring";
import { nextAllowedScheduleAt, nextScheduleAt, scheduleExecutionTask } from "@/lib/scheduling";
import { executeWorkspaceApp } from "@/lib/app-runtime";
import { executeWorkspacePlaybook } from "@/lib/playbook-runtime";
import { executeTicketReplyDraft } from "@/lib/ticket-runtime";
import { executeTicketReplySend } from "@/lib/ticket-send-runtime";
import { createDealInState, updateDealInState } from "@/lib/deal-runtime";
import { publishContentInState, scheduleContentInState } from "@/lib/content-runtime";
import { scheduleCampaignInState } from "@/lib/campaign-runtime";
import { executeCampaignBroadcast } from "@/lib/campaign-send-runtime";

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

function listActionMatches(action: SmartListAction, row: WorkspaceState["lists"][number]["rows"][number]) {
  if (action.condition === "new") return row.status === "new";
  if (action.condition === "score_at_least") return row.score >= (action.scoreThreshold || 0);
  return true;
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
  let listActionUsage: { unit: "ai" | "data"; units: number; feature: string } | null = null;
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
        state.lists.unshift(artifacts.list);
        state.leadSources.unshift(artifacts.leadSource);
        state.inboundAgents.unshift(artifacts.inboundAgent);
        state.sites.unshift(artifacts.site);
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
        addActivity(state, { type: "system", title: `${companyName} was discovered`, detail: `${artifacts.document.name} indexed · ${artifacts.employees.length} operators, ${artifacts.missions.length} missions, ${artifacts.content.length} content briefs, public research, a lead workspace, and a live public operator are ready`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.bootstrap", metadata: { goal, source: discovery.url ? "public_url" : "operator_brief" } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The workspace was created, but its audit record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(next), discovery: { title: next.workspace.onboarding.sourceTitle, description: next.workspace.onboarding.sourceDescription, url: next.workspace.onboarding.companyUrl } });
    }

    if (action === "enroll-row") {
      const current = await getWorkspace(companyId);
      const sequence = current.sequences.find((candidate) => candidate.id === String(body.sequenceId || ""));
      if (!sequence) return json({ error: "Sequence not found." }, { status: 400 });
      if (sequenceRequiresGmail(sequence)) {
        try {
          const integrations = await listIntegrationSummaries(companyId);
          if (integrations.find((integration) => integration.provider === "gmail")?.status !== "connected") {
            return json({ error: "Connect Gmail before enrolling a lead in an email sequence." }, { status: 400 });
          }
        } catch {
          return json({ error: "Gmail connection status is unavailable. Apply the platform database migration." }, { status: 503 });
        }
      }
    }

    if (action === "create-sequence-task") {
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
      if (sequence.status !== "live") return json({ error: "Activate the sequence after reviewing its steps before creating a task." }, { status: 400 });
      if (step.channel === "Email") return json({ error: "Email steps require the approved Gmail send action." }, { status: 400 });
      if (row.status !== "enriched") return json({ error: "Research the lead before creating a sequence task." }, { status: 400 });
      if (row.enrollmentStatus === "replied") return json({ error: "This sequence is paused because the lead replied." }, { status: 400 });
      if (row.enrollmentStatus !== "enrolled") return json({ error: "Enroll the lead before creating a sequence task." }, { status: 400 });
      if (row.sequenceId && row.sequenceId !== sequence.id) return json({ error: "This lead is enrolled in a different sequence." }, { status: 409 });
      if ((row.sequenceStepIndex || 0) > stepIndex) return json({ error: "This sequence step has already been completed." }, { status: 409 });
      if (current.suppressedEmails.includes(row.email.toLowerCase())) return json({ error: "This address is suppressed and cannot receive sequence work." }, { status: 400 });
      const taskTitle = `Manual sequence task · ${row.name} · ${step.title}`;
      const next = await updateWorkspace(companyId, (state) => {
        const liveList = state.lists.find((item) => item.id === listId);
        const liveRow = liveList?.rows.find((item) => item.id === rowId);
        const liveSequence = state.sequences.find((item) => item.id === sequenceId);
        if (!liveList || !liveRow || !liveSequence) throw new Error("Lead, sequence, or sequence step not found.");
        const existing = state.missions.find((mission) => mission.title === taskTitle);
        if (existing) return state;
        const employeeId = state.employees.find((employee) => employee.status === "live")?.id || null;
        const createdAt = timestamp();
        const mission: Mission = {
          id: createId("mission"),
          title: taskTitle,
          description: `${step.channel} follow-up for ${liveRow.name} at ${liveRow.company} (${liveRow.email}).\n\nInstructions: ${step.body}`,
          status: "ready",
          priority: "normal",
          employeeId,
          sourceDocumentIds: [],
          output: null,
          runId: null,
          dueAt: null,
          createdAt,
          updatedAt: createdAt,
        };
        state.missions.unshift(mission);
        liveRow.sequenceId = liveSequence.id;
        liveRow.sequenceStepIndex = stepIndex + 1;
        liveRow.sequenceStatus = liveRow.sequenceStepIndex >= liveSequence.steps.length ? "completed" : "active";
        liveRow.lastAction = `Created ${step.channel} task: ${step.title}`;
        addActivity(state, { type: "sequence", title: `${liveRow.name} received a manual sequence task`, detail: `${step.channel} · ${step.title} · added to Missions` });
        return state;
      });
      try {
        await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.create-sequence-task", resourceType: "sequence", resourceId: sequence.id, metadata: { listId, rowId, stepIndex, taskTitle } });
      } catch {
        if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The sequence task was saved, but its audit record could not be stored." }, { status: 503 });
      }
      return json({ state: workspaceStateForClient(next), taskTitle }, { headers: rateLimitHeaders(identity.context) });
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

    if (action === "send-ticket-reply") {
      try {
        const execution = await executeTicketReplySend({ workspaceId: companyId, ticketId: String(body.ticketId || ""), body: String(body.body || "").trim() || undefined, senderEmail: identity.context.email });
        let auditRecorded = true;
        try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "gmail.ticket_reply_sent", resourceType: "ticket", resourceId: execution.ticket.id, metadata: { providerMessageId: execution.delivery.messageId, recipient: execution.ticket.requesterEmail } }); } catch { auditRecorded = false; }
        return json({ state: workspaceStateForClient(execution.state), ticket: execution.ticket, delivery: { ...execution.delivery, auditRecorded } }, { headers: rateLimitHeaders(identity.context) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gmail ticket reply failed.";
        const status = message === "Ticket not found." ? 404 : message.includes("daily send limit") ? 429 : message.includes("unknown provider outcome") || message.includes("already in progress") ? 409 : message.includes("could not be checked") || message.includes("could not persist") ? 503 : 400;
        return json({ error: message }, { status });
      }
    }

    if (action === "send-campaign") {
      try {
        const execution = await executeCampaignBroadcast({ workspaceId: companyId, campaignId: String(body.campaignId || ""), senderEmail: identity.context.email });
        let auditRecorded = true;
        try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.campaign_broadcast_sent", resourceType: "campaign", resourceId: execution.campaign.id, metadata: execution.delivery }); } catch { auditRecorded = false; }
        return json({ state: workspaceStateForClient(execution.state), campaign: execution.campaign, delivery: { ...execution.delivery, auditRecorded } }, { headers: rateLimitHeaders(identity.context) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Campaign broadcast failed.";
        const status = message === "Campaign not found." ? 404 : message.includes("already") ? 409 : message.includes("daily send limit") ? 429 : message.includes("unavailable") ? 503 : 400;
        return json({ error: message }, { status });
      }
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
      const launchContent = current.content[0];
      const launchContentEmployee = launchContent
        ? findEmployee(current, launchContent.employeeId || "") || employee
        : null;
      let launchContentResult: LlmResult | null = null;
      if (launchContent && launchContentEmployee && current.workspace.aiCredits.remaining >= 4) {
        try {
          launchContentResult = await generateEmployeeReply(launchContentEmployee, `Create a ${launchContent.channel} draft titled "${launchContent.title}". Objective: ${launchContent.objective}. Use only the discovered workspace context, preserve the company's voice, avoid unsupported claims, and include one note about evidence that still needs review.`, current.documents);
        } catch {
          launchContentResult = null;
        }
      }
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
        if (launchContent && launchContentResult && launchContentEmployee) {
          const liveContent = findContent(state, launchContent.id);
          const liveContentEmployee = findEmployee(state, launchContentEmployee.id);
          if (liveContent && liveContentEmployee) {
            const contentRun = makeRun(state, liveContentEmployee, `Create a ${liveContent.channel} draft titled "${liveContent.title}". Objective: ${liveContent.objective}.`, "manual", launchContentResult, startedAt);
            liveContent.status = "review";
            liveContent.body = launchContentResult.content;
            liveContent.employeeId = liveContentEmployee.id;
            liveContent.missionId = firstMission?.id || null;
            liveContent.updatedAt = contentRun.createdAt;
            addActivity(state, { type: "content", title: `${liveContent.title} is ready for review`, detail: `${liveContentEmployee.name} · first launch draft · score ${contentRun.score}` });
          }
        }
        state.workspace.onboarding.status = "proved";
        state.workspace.onboarding.runId = run.id;
        addActivity(state, { type: "run", title: `${liveEmployee.name} delivered the first brief`, detail: `Score ${run.score} · ${firstMission ? `${firstMission.title} is ready for review` : `grounded in ${state.documents[0]?.name || "workspace context"}`}`, });
        return state;
      });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.onboarding_run", resourceType: "employee", resourceId: employee.id }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The brief was saved, but its audit record could not be stored." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "onboarding_brief", unit: "ai", units: launchContentResult ? 4 : 2 }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(next), persisted: true, error: "The brief was saved, but its usage record could not be stored." }, { status: 503 }); }
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

    if (action === "run-app") {
      const appId = String(body.appId || "").trim();
      if (!appId) return json({ error: "App is required." }, { status: 400 });
      const execution = await executeWorkspaceApp({ workspaceId: companyId, appId, input: String(body.input || ""), source: "ui" });
      try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.app_run", resourceType: "app", resourceId: appId, metadata: { runId: execution.run.id } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The app run was saved, but its audit record could not be stored." }, { status: 503 }); }
      try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "app_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The app run was saved, but its usage record could not be stored." }, { status: 503 }); }
      return json({ state: workspaceStateForClient(execution.state), appId, runId: execution.run.id, output: execution.run.output, provider: execution.result.provider }, { headers: rateLimitHeaders(identity.context) });
    }

    if (action === "run-playbook") {
      try {
        const execution = await executeWorkspacePlaybook({ workspaceId: companyId, playbookId: String(body.playbookId || ""), employeeId: String(body.employeeId || "").trim() || undefined, input: String(body.input || ""), source: "ui" });
        try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.playbook_run", resourceType: "playbook", resourceId: execution.playbook.id, metadata: { runId: execution.run.id, missionId: execution.mission.id } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The playbook run was saved, but its audit record could not be stored." }, { status: 503 }); }
        try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "playbook_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The playbook run was saved, but its usage record could not be stored." }, { status: 503 }); }
        return json({ state: workspaceStateForClient(execution.state), missionId: execution.mission.id, runId: execution.run.id, output: execution.run.output, provider: execution.result.provider }, { headers: rateLimitHeaders(identity.context) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Playbook execution failed.";
        const status = message === "Playbook not found." ? 404 : message.includes("AI Credits") ? 402 : 400;
        return json({ error: message }, { status });
      }
    }

    if (action === "draft-ticket-reply") {
      try {
        const execution = await executeTicketReplyDraft({ workspaceId: companyId, ticketId: String(body.ticketId || ""), employeeId: String(body.employeeId || "").trim() || undefined, source: "ui" });
        try { await recordAuditEvent({ workspaceId: companyId, actorId: identity.context.userId, action: "workspace.ticket_reply_draft", resourceType: "ticket", resourceId: execution.ticket.id, metadata: { employeeId: execution.employee.id } }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The reply draft was saved, but its audit record could not be stored." }, { status: 503 }); }
        try { await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "ticket_reply_draft", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(execution.state), persisted: true, error: "The reply draft was saved, but its usage record could not be stored." }, { status: 503 }); }
        return json({ state: workspaceStateForClient(execution.state), ticket: execution.ticket, output: execution.result.content, provider: execution.result.provider }, { headers: rateLimitHeaders(identity.context) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Support reply drafting failed.";
        const status = message === "Ticket not found." ? 404 : message.includes("AI Credits") ? 402 : 400;
        return json({ error: message }, { status });
      }
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
          scheduleContentInState(state, String(body.contentId || ""), body.scheduledAt ? String(body.scheduledAt) : null);
          return state;
        }
        case "publish-content": {
          publishContentInState(state, String(body.contentId || ""));
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
          throw new Error("Playbook runs are executed before state mutation.");
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
            tools: [],
            memory: [],
            knowledgeDocumentIds: [],
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
          state.lists.unshift({ id: createId("list"), name, description: String(body.description || "").trim() || "Imported prospects ready for qualification.", updatedAt: timestamp(), rows: [], actions: [] });
          addActivity(state, { type: "lead", title: `${name} was created`, detail: "Ready for lead imports and public research", });
          return state;
        }
        case "create-deal": {
          createDealInState(state, { name: String(body.name || ""), company: String(body.company || ""), amount: Number(body.amount || 0), currency: String(body.currency || "USD"), stage: body.stage as never, personId: String(body.personId || "").trim() || null, ownerEmployeeId: String(body.ownerEmployeeId || "").trim() || null, source: String(body.source || "manual"), nextAction: String(body.nextAction || ""), closeDate: body.closeDate ? String(body.closeDate) : null, notes: String(body.notes || "") });
          return state;
        }
        case "update-deal": {
          updateDealInState(state, String(body.dealId || ""), { stage: body.stage as never, stageNote: String(body.stageNote || ""), amount: body.amount === undefined ? undefined : Number(body.amount), nextAction: body.nextAction === undefined ? undefined : String(body.nextAction || ""), closeDate: body.closeDate === undefined ? undefined : (body.closeDate ? String(body.closeDate) : null), notes: body.notes === undefined ? undefined : String(body.notes || ""), ownerEmployeeId: body.ownerEmployeeId === undefined ? undefined : (String(body.ownerEmployeeId || "").trim() || null) });
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
        case "create-list-action": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const name = String(body.name || "").trim();
          if (!list || !name) throw new Error("List and action name are required.");
          const type = (["enrich", "run_employee", "suppress", "enroll"] as const).includes(body.type as never) ? body.type as SmartListAction["type"] : "enrich";
          const condition = (["all", "new", "score_at_least"] as const).includes(body.condition as never) ? body.condition as SmartListAction["condition"] : "new";
          const scoreThreshold = Number(body.scoreThreshold || 0);
          const employeeId = String(body.employeeId || "").trim() || null;
          const sequenceId = String(body.sequenceId || "").trim() || null;
          if (type === "run_employee" && (!employeeId || !findEmployee(state, employeeId))) throw new Error("Choose a valid employee for this action.");
          if (type === "enroll" && (!sequenceId || !state.sequences.some((sequence) => sequence.id === sequenceId))) throw new Error("Choose a valid sequence for this action.");
          if (condition === "score_at_least" && (!Number.isFinite(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 100)) throw new Error("Score threshold must be between 0 and 100.");
          const action: SmartListAction = { id: createId("list-action"), name, type, condition, scoreThreshold: condition === "score_at_least" ? scoreThreshold : undefined, employeeId, sequenceId, active: true, lastRunAt: null, runCount: 0, lastSummary: null };
          list.actions = [action, ...(list.actions || [])];
          list.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${name} was added to ${list.name}`, detail: `${type} action · condition ${condition}` });
          return state;
        }
        case "toggle-list-action": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const action = list?.actions?.find((item) => item.id === String(body.actionId || ""));
          if (!list || !action) throw new Error("List action not found.");
          action.active = body.active !== false;
          addActivity(state, { type: "lead", title: `${action.name} ${action.active ? "enabled" : "paused"}`, detail: `Batch action on ${list.name}` });
          return state;
        }
        case "run-list-action": {
          const list = state.lists.find((item) => item.id === String(body.listId || ""));
          const action = list?.actions?.find((item) => item.id === String(body.actionId || ""));
          if (!list || !action) throw new Error("List action not found.");
          if (!action.active) throw new Error("This list action is paused.");
          const rows = list.rows.filter((row) => listActionMatches(action, row)).slice(0, 50);
          if (!rows.length) {
            action.lastRunAt = timestamp();
            action.lastSummary = "No rows matched the action condition.";
            return state;
          }
          const cost = rows.length * 2;
          if (action.type === "enrich" && state.workspace.dataCredits.remaining < cost) throw new Error(`This action needs ${cost} Data Credits, but only ${state.workspace.dataCredits.remaining} remain.`);
          if (action.type === "run_employee" && state.workspace.aiCredits.remaining < cost) throw new Error(`This action needs ${cost} AI Credits, but only ${state.workspace.aiCredits.remaining} remain.`);
          let processed = 0;
          for (const row of rows) {
            if (action.type === "enrich") {
              const research = await researchPersonCompany(row.email, row.company);
              state.workspace.dataCredits.remaining -= 2;
              const score = scoreLead({ email: row.email, role: row.role, company: row.company, researchText: research.text, idealCustomer: state.profile.idealCustomer });
              row.status = "enriched";
              row.emailStatus = "unknown";
              row.score = score.score;
              row.scoreReasons = score.reasons;
              row.intent = score.intent;
              row.companyInsight = research.insight;
              row.lastAction = `Batch research · ${research.url}`;
            } else if (action.type === "run_employee") {
              const employee = action.employeeId ? findEmployee(state, action.employeeId) : undefined;
              if (!employee) throw new Error("The action employee no longer exists.");
              const task = `Review this Smart List lead and give one grounded next action.\nName: ${row.name}\nCompany: ${row.company}\nRole: ${row.role}\nCompany evidence: ${row.companyInsight}`;
              const result = await generateEmployeeReply(employee, task, state.documents);
              const run = makeRun(state, employee, task, "manual", result, Date.now());
              row.lastAction = `${employee.name} reviewed this row · score ${run.score}`;
            } else if (action.type === "suppress") {
              const email = row.email.toLowerCase();
              if (!state.suppressedEmails.includes(email)) state.suppressedEmails.push(email);
              row.lastAction = "Batch suppressed for this workspace";
            } else if (action.type === "enroll") {
              const sequence = action.sequenceId ? state.sequences.find((candidate) => candidate.id === action.sequenceId) : undefined;
              if (!sequence) throw new Error("The action sequence no longer exists.");
              if (row.status !== "enriched" || state.suppressedEmails.includes(row.email.toLowerCase()) || row.enrollmentStatus === "enrolled") continue;
              row.enrollmentStatus = "enrolled";
              row.sequenceId = sequence.id;
              row.sequenceStepIndex = 0;
              row.sequenceStatus = "active";
              row.lastSentAt = null;
              row.lastProviderMessageId = null;
              row.lastAction = `Batch enrolled in ${sequence.name}`;
              sequence.enrolled += 1;
            }
            processed += 1;
          }
          action.lastRunAt = timestamp();
          action.runCount += 1;
          action.lastSummary = `${processed} row${processed === 1 ? "" : "s"} processed${processed < rows.length ? ` · ${rows.length - processed} skipped` : ""}.`;
          if (action.type === "enrich") listActionUsage = { unit: "data", units: processed * 2, feature: "smart_list_batch_research" };
          if (action.type === "run_employee") listActionUsage = { unit: "ai", units: processed * 2, feature: "smart_list_batch_employee" };
          list.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${action.name} completed`, detail: `${list.name} · ${action.lastSummary}` });
          return state;
        }
        case "create-sequence": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Sequence name is required.");
          const steps = buildSequenceSteps(body.steps, {
            subject: String(body.subject || "").trim(),
            body: String(body.body || "Write a useful, specific first touch. Require human approval before sending."),
          });
          state.sequences.unshift({ id: createId("seq"), name, status: "draft", audience: String(body.audience || "Imported leads"), enrolled: 0, sent: 0, replied: 0, booked: 0, steps });
          addActivity(state, { type: "sequence", title: `${name} was created`, detail: `Draft sequence · ${steps.length} step${steps.length === 1 ? "" : "s"} · Gmail connection and approval required before sending`, });
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
        case "update-employee-config": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          if (!employee) throw new Error("Employee not found.");
          if (employee.locked) throw new Error("This employee is locked. Unlock it in Settings before changing its configuration.");
          const model = String(body.model || employee.model).trim().split(" · ")[0];
          if (!model || model.length > 80 || /[\u0000-\u001f\u007f\s]/.test(model)) throw new Error("Choose a valid local model name.");
          const temperature = Number(body.temperature ?? employee.temperature ?? 0.35);
          if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new Error("Temperature must be between 0 and 1.");
          const reasoning = (["focused", "balanced", "deep"] as const).includes(body.reasoning as never)
            ? body.reasoning as "focused" | "balanced" | "deep"
            : employee.reasoning || "balanced";
          const tools = Array.isArray(body.tools)
            ? body.tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0).map((tool) => tool.trim()).slice(0, 30)
            : employee.tools || [];
          const requestedDocumentIds = Array.isArray(body.knowledgeDocumentIds)
            ? body.knowledgeDocumentIds.filter((documentId): documentId is string => typeof documentId === "string")
            : employee.knowledgeDocumentIds || [];
          const knowledgeDocumentIds = requestedDocumentIds.filter((documentId) => state.documents.some((document) => document.id === documentId));
          employee.model = model;
          employee.temperature = temperature;
          employee.reasoning = reasoning;
          employee.memoryScope = body.memoryScope === "employee" ? "employee" : body.memoryScope === "company" ? "company" : employee.memoryScope;
          employee.tools = tools;
          employee.knowledgeDocumentIds = knowledgeDocumentIds;
          addActivity(state, { type: "employee", title: `${employee.name} configuration updated`, detail: `${model} · ${reasoning} reasoning · ${knowledgeDocumentIds.length} attached source${knowledgeDocumentIds.length === 1 ? "" : "s"}` });
          return state;
        }
        case "add-employee-memory": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const memory = String(body.memory || "").trim();
          if (!employee || !memory) throw new Error("Employee and memory are required.");
          if (memory.length > 500) throw new Error("Keep an employee memory under 500 characters.");
          employee.memory = employee.memory || [];
          if (!employee.memory.some((fact) => fact.toLowerCase() === memory.toLowerCase())) employee.memory.unshift(memory);
          employee.memory = employee.memory.slice(0, 100);
          addActivity(state, { type: "employee", title: `${employee.name} memory updated`, detail: "A durable operator fact was saved to the workspace record." });
          return state;
        }
        case "remove-employee-memory": {
          const employee = findEmployee(state, String(body.employeeId || ""));
          const memory = String(body.memory || "").trim();
          if (!employee || !memory) throw new Error("Employee and memory are required.");
          employee.memory = (employee.memory || []).filter((fact) => fact !== memory);
          addActivity(state, { type: "employee", title: `${employee.name} memory removed`, detail: "The selected durable operator fact was removed." });
          return state;
        }
        case "toggle-employee-lock": {
          if (!hasPermission(identity.context, "settings:write")) throw new Error("Only workspace administrators can lock or unlock employee configuration.");
          const employee = findEmployee(state, String(body.employeeId || ""));
          if (!employee) throw new Error("Employee not found.");
          employee.locked = body.locked === true;
          addActivity(state, { type: "employee", title: `${employee.name} configuration ${employee.locked ? "locked" : "unlocked"}`, detail: employee.locked ? "Only workspace administrators can unlock this employee." : "Configuration changes are available again." });
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
          if (sequence.status !== "live") throw new Error("Activate the sequence after reviewing its steps before enrolling a lead.");
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
          const activeHoursStart = String(body.activeHoursStart || "").trim();
          const activeHoursEnd = String(body.activeHoursEnd || "").trim();
          const activeHours = activeHoursStart || activeHoursEnd ? { start: activeHoursStart || "09:00", end: activeHoursEnd || "17:00" } : null;
          if (activeHours && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(activeHours.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(activeHours.end))) throw new Error("Active hours must use HH:MM.");
          const weekdays = Array.isArray(body.weekdays)
            ? body.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
            : [0, 1, 2, 3, 4, 5, 6];
          if (!weekdays.length) throw new Error("Choose at least one active weekday.");
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
            activeHours,
            weekdays: [...new Set(weekdays)],
            lastOutput: null,
            runLog: [],
          };
          state.schedules.unshift(schedule);
          addActivity(state, { type: "system", title: `${name} was scheduled`, detail: `${cadence} · ${employeeId ? findEmployee(state, employeeId)?.name : "unassigned"}` });
          return state;
        }
        case "toggle-schedule": {
          const schedule = state.schedules.find((candidate) => candidate.id === String(body.scheduleId || ""));
          if (!schedule) throw new Error("Schedule not found.");
          schedule.active = body.active !== false;
          if (schedule.active && new Date(schedule.nextRunAt).getTime() <= Date.now()) schedule.nextRunAt = nextAllowedScheduleAt(schedule, state.profile.timezone, Date.now());
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
          const task = scheduleExecutionTask(schedule);
          const result = await generateEmployeeReply(employee, task, state.documents);
          const run = makeRun(state, employee, task, "heartbeat", result, startedAt);
          schedule.lastRunAt = run.createdAt;
          schedule.runCount += 1;
          schedule.lastOutput = result.content;
          schedule.runLog = [{ runId: run.id, createdAt: run.createdAt, output: result.content, score: run.score }, ...(schedule.runLog || [])].slice(0, 20);
          schedule.active = schedule.cadence === "once" ? false : schedule.active;
          schedule.nextRunAt = schedule.active ? nextAllowedScheduleAt(schedule, state.profile.timezone, Date.now()) : schedule.nextRunAt;
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
        case "add-person-to-list": {
          const person = state.people.find((candidate) => candidate.id === String(body.personId || ""));
          const list = state.lists.find((candidate) => candidate.id === String(body.listId || ""));
          if (!person || !list) throw new Error("Person or Smart List not found.");
          if (person.status !== "qualified") throw new Error("Qualify the person with public evidence before moving them into a Smart List.");
          if (state.lists.some((candidate) => candidate.rows.some((row) => row.email.toLowerCase() === person.email.toLowerCase()))) throw new Error("This person is already in a Smart List in this workspace.");
          list.rows.unshift({ id: createId("row"), name: person.name, email: person.email, company: person.company, role: person.title, location: person.location, score: person.score, scoreReasons: ["Moved from qualified People record"], status: "enriched", emailStatus: "unknown", intent: "Public context captured", companyInsight: person.notes || "Public company evidence captured in People.", enrollmentStatus: "not enrolled", lastAction: `Moved from People into ${list.name}` });
          list.updatedAt = timestamp();
          addActivity(state, { type: "lead", title: `${person.name} moved into ${list.name}`, detail: "Qualified People record is ready for Smart List workflows" });
          return state;
        }
        case "create-lead-source": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Source name is required.");
          const type = (["manual", "csv", "public"] as const).includes(body.type as never) ? body.type as LeadSource["type"] : "manual";
          const listId = String(body.listId || "").trim() || null;
          if (type === "csv" && (!listId || !state.lists.some((list) => list.id === listId))) throw new Error("Choose a Smart List for the CSV source.");
          const query = String(body.query || "").trim() || (type === "public" ? name : null);
          const source: LeadSource = { id: createId("source"), name, type, listId, query, results: [], status: "ready", recordCount: 0, lastRunAt: null, lastSummary: null, createdAt: timestamp() };
          state.leadSources.unshift(source);
          addActivity(state, { type: "lead", title: `${name} was added as a lead source`, detail: `${type} source · ready to run${listId ? ` · ${state.lists.find((list) => list.id === listId)?.name}` : ""}` });
          return state;
        }
        case "run-lead-source": {
          const source = state.leadSources.find((candidate) => candidate.id === String(body.sourceId || ""));
          if (!source) throw new Error("Lead source not found.");
          source.status = "running";
          if (source.type === "csv") {
            const list = source.listId ? state.lists.find((candidate) => candidate.id === source.listId) : undefined;
            if (!list) throw new Error("The source Smart List no longer exists.");
            source.recordCount = list.rows.length;
            source.results = [];
            source.lastSummary = `${list.rows.length} Smart List row${list.rows.length === 1 ? "" : "s"} available for research and workflow actions.`;
          } else if (source.type === "public") {
            if (state.workspace.dataCredits.remaining < 2) throw new Error("Not enough Data Credits for public research.");
            const result = await researchPublicKeyword(source.query || source.name);
            state.workspace.dataCredits.remaining -= 2;
            source.recordCount = result.matches.length;
            source.results = result.matches;
            source.lastSummary = result.matches.slice(0, 3).map((match) => match.title).join(" · ") || "No public matches found.";
          } else {
            source.recordCount = state.people.length;
            source.results = [];
            source.lastSummary = `${state.people.length} manually owned People record${state.people.length === 1 ? "" : "s"} available for qualification.`;
          }
          source.status = "completed";
          source.lastRunAt = timestamp();
          addActivity(state, { type: "lead", title: `${source.name} finished`, detail: `${source.recordCount} record${source.recordCount === 1 ? "" : "s"} captured · ${source.lastSummary || "ready for the next workflow"}` });
          return state;
        }
        case "create-campaign": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Campaign name is required.");
          const type = (["broadcast", "content", "event"] as const).includes(body.type as never) ? body.type as Campaign["type"] : "content";
          if (type === "broadcast") {
            if (!String(body.listId || "").trim()) throw new Error("Choose a Smart List for a broadcast campaign.");
            if (!String(body.subject || "").trim() || !String(body.body || "").trim()) throw new Error("Broadcast campaigns need a subject and body.");
          }
          if (type === "event") throw new Error("Event campaigns are not executable in the open-source launch scope.");
          const campaign: Campaign = { id: createId("campaign"), name, type, audience: String(body.audience || "Workspace audience").trim(), status: "draft", scheduledAt: null, contentId: String(body.contentId || "").trim() || null, listId: String(body.listId || "").trim() || null, subject: String(body.subject || "").trim() || null, body: String(body.body || "").trim() || null, createdAt: timestamp(), updatedAt: timestamp() };
          state.campaigns.unshift(campaign);
          addActivity(state, { type: "content", title: `${name} was created`, detail: `${type} campaign · draft` });
          return state;
        }
        case "schedule-campaign": {
          scheduleCampaignInState(state, String(body.campaignId || ""), body.scheduledAt ? String(body.scheduledAt) : null);
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
          const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || createId("site");
          let slug = baseSlug;
          let collision = 2;
          while (state.sites.some((site) => site.slug === slug)) slug = `${baseSlug}-${collision++}`;
          const agentId = String(body.agentId || "").trim() || state.inboundAgents.find((agent) => agent.status === "live")?.id || null;
          const site: SiteRecord = { id: createId("site"), name, kind, slug, agentId, status: "draft", headline, body: String(body.body || "").trim(), createdAt: timestamp(), updatedAt: timestamp() };
          state.sites.unshift(site);
          addActivity(state, { type: "system", title: `${name} was created`, detail: `${kind.replace("_", " ")} · draft` });
          return state;
        }
        case "publish-site": {
          const site = state.sites.find((candidate) => candidate.id === String(body.siteId || ""));
          if (!site) throw new Error("Site not found.");
          if (!site.agentId) throw new Error("Attach a live inbound agent before publishing this site.");
          const agent = state.inboundAgents.find((candidate) => candidate.id === site.agentId && candidate.status === "live");
          if (!agent) throw new Error("The site's inbound agent must be live before publishing.");
          site.status = "published";
          site.updatedAt = timestamp();
          addActivity(state, { type: "system", title: `${site.name} was published`, detail: `/site/${site.slug}` });
          return state;
        }
        case "create-app": {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("App name is required.");
          const description = String(body.description || "").trim() || "A workspace-native workflow.";
          const task = String(body.task || "").trim() || description;
          const app: AppRecord = { id: createId("app"), name, description, type: (["workflow", "api", "mcp"] as const).includes(body.type as never) ? body.type as AppRecord["type"] : "workflow", employeeId: String(body.employeeId || "").trim() || null, task, status: "draft", lastRunAt: null, lastRunId: null, lastOutput: null, lastError: null, runCount: 0, createdAt: timestamp(), updatedAt: timestamp() };
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
            requesterEmail: String(body.requesterEmail || "").trim().toLowerCase() || null,
            sourceProviderMessageId: null,
            replyProviderMessageId: null,
            replySentAt: null,
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
    const ranPublicLeadSource = action === "run-lead-source" && updated.leadSources.find((source) => source.id === String(body.sourceId || ""))?.type === "public";
    if (ranPublicLeadSource) {
      try {
        await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: "lead_source_public_research", unit: "data", units: 2 });
      } catch {
        if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The research was saved, but its usage record could not be stored." }, { status: 503 });
      }
    }
    if (action === "run-list-action") {
      const usage = listActionUsage as { unit: "ai" | "data"; units: number; feature: string } | null;
      if (usage && usage.units > 0) {
        try {
          await recordUsage({ workspaceId: companyId, actorId: identity.context.userId, feature: usage.feature, unit: usage.unit, units: usage.units });
        } catch {
          if (process.env.NODE_ENV === "production") return json({ state: workspaceStateForClient(updated), persisted: true, error: "The batch action was saved, but its usage record could not be stored." }, { status: 503 });
        }
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
