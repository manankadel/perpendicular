import crypto from "node:crypto";
import { defaultOutboundSafetySettings, normalizeOutboundSafetySettings, type OutboundSafetySettings } from "@/lib/outbound-safety";

export type { OutboundSafetySettings } from "@/lib/outbound-safety";

export type Department = "Growth" | "Content" | "Support" | "Operations";

export type Employee = {
  id: string;
  name: string;
  title: string;
  department: Department;
  avatar: string;
  systemPrompt: string;
  model: string;
  status: "live" | "paused";
  memoryScope: "company" | "employee";
  tools?: string[];
  memory?: string[];
  knowledgeDocumentIds?: string[];
  temperature?: number;
  reasoning?: "focused" | "balanced" | "deep";
  locked?: boolean;
  score: number;
  scoreTrend: number[];
  lastRunAt: string | null;
  schedule: {
    enabled: boolean;
    cadence: "every 15m" | "hourly" | "daily" | "weekly";
    task: string;
    nextRunAt: string | null;
  } | null;
  promptVersions: PromptVersion[];
  goldenTests: GoldenTest[];
};

export type PromptVersion = {
  id: string;
  version: number;
  prompt: string;
  author: string;
  createdAt: string;
  note: string;
  active: boolean;
  goldenScore?: number | null;
};

export type GoldenTest = {
  id: string;
  input: string;
  expected: string;
  lastScore: number;
};

export type DocumentRecord = {
  id: string;
  name: string;
  source: "playbook" | "url" | "upload";
  content: string;
  status: "ready" | "indexing";
  chunks: number;
  updatedAt: string;
  employeeIds: string[];
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: string[];
};

export type Conversation = {
  id: string;
  employeeId: string;
  messages: ConversationMessage[];
};

export type WidgetConversation = {
  id: string;
  sessionId: string;
  employeeId: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
};

export type WidgetSettings = {
  enabled: boolean;
  publicKeyHash: string | null;
  employeeId: string | null;
  greeting: string;
};

export type Run = {
  id: string;
  employeeId: string;
  trigger: "manual" | "heartbeat" | "evaluation";
  task: string;
  output: string;
  score: number;
  reason: string;
  status: "completed" | "running" | "failed";
  createdAt: string;
  durationMs: number;
  trace: TraceStep[];
};

export type TraceStep = {
  label: string;
  detail: string;
  durationMs: number;
  cost: number;
  status: "complete" | "skipped";
};

export type SmartRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  location: string;
  score: number;
  scoreReasons?: string[];
  status: "new" | "enriched";
  emailStatus: "unknown" | "verified" | "risky";
  intent: string;
  companyInsight: string;
  enrollmentStatus: "not enrolled" | "enrolled" | "replied";
  lastAction: string | null;
  sequenceId?: string | null;
  sequenceStepIndex?: number;
  sequenceStatus?: "active" | "paused" | "replied" | "completed" | null;
  lastSentAt?: string | null;
  lastProviderMessageId?: string | null;
};

export type SmartList = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rows: SmartRow[];
  actions?: SmartListAction[];
};

export type SmartListAction = {
  id: string;
  name: string;
  type: "enrich" | "run_employee" | "suppress" | "enroll";
  condition: "all" | "new" | "score_at_least";
  scoreThreshold?: number;
  employeeId?: string | null;
  sequenceId?: string | null;
  active: boolean;
  lastRunAt: string | null;
  runCount: number;
  lastSummary: string | null;
};

export type Sequence = {
  id: string;
  name: string;
  status: "live" | "draft";
  audience: string;
  enrolled: number;
  sent?: number;
  replied: number;
  booked: number;
  steps: SequenceStep[];
};

export type SequenceStep = {
  id: string;
  channel: "Email" | "LinkedIn" | "Task";
  title: string;
  delay: string;
  body: string;
  subject?: string;
};

export type Ticket = {
  id: string;
  subject: string;
  requester: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "resolved";
  createdAt: string;
  slaDueAt: string;
  assignee: string;
  csat: number | null;
  replyDraft?: string | null;
  replyCitations?: string[];
  requesterEmail?: string | null;
  sourceProviderMessageId?: string | null;
  replyProviderMessageId?: string | null;
  replySentAt?: string | null;
};

export type UsageSummary = {
  periodStart: string;
  periodEnd: string;
  aiUnits: number;
  dataUnits: number;
  byFeature: Array<{
    feature: string;
    units: number;
  }>;
};

export type Activity = {
  id: string;
  type: "employee" | "run" | "lead" | "sequence" | "ticket" | "mission" | "content" | "playbook" | "system";
  title: string;
  detail: string;
  createdAt: string;
};

export type OnboardingGoal = "revenue" | "delivery" | "content" | "support";

export type WorkspaceProfile = {
  industry: string;
  website: string | null;
  description: string;
  idealCustomer: string;
  goals: string[];
  brandVoice: string;
  timezone: string;
  updatedAt: string;
};

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member" | "operator";
  status: "active" | "invited";
  createdAt: string;
};

export type ScheduledWork = {
  id: string;
  name: string;
  description: string;
  employeeId: string | null;
  cadence: "once" | "every 15m" | "hourly" | "daily" | "weekly";
  nextRunAt: string;
  active: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  activeHours?: { start: string; end: string } | null;
  weekdays?: number[];
  lastOutput?: string | null;
  runLog?: Array<{ runId: string; createdAt: string; output: string; score: number }>;
};

export type PersonRecord = {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  location: string;
  score: number;
  status: "new" | "enriched" | "qualified";
  source: "manual" | "csv" | "public";
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";

export type DealRecord = {
  id: string;
  name: string;
  company: string;
  personId: string | null;
  amount: number;
  currency: string;
  stage: DealStage;
  probability: number;
  ownerEmployeeId: string | null;
  source: string;
  nextAction: string;
  closeDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  stageHistory: Array<{ stage: DealStage; at: string; note: string }>;
};

export type LeadSource = {
  id: string;
  name: string;
  type: "manual" | "csv" | "public";
  listId?: string | null;
  query?: string | null;
  results?: Array<{ title: string; url: string; snippet: string }>;
  status: "ready" | "running" | "completed" | "failed";
  recordCount: number;
  lastRunAt: string | null;
  lastSummary?: string | null;
  createdAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  type: "broadcast" | "content" | "event";
  audience: string;
  status: "draft" | "scheduled" | "running" | "completed";
  scheduledAt: string | null;
  contentId: string | null;
  listId: string | null;
  subject?: string | null;
  body?: string | null;
  lastRunAt?: string | null;
  lastResult?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KeywordMonitor = {
  id: string;
  keyword: string;
  status: "active" | "paused";
  lastCheckedAt: string | null;
  matchCount: number;
  latestSummary: string | null;
  createdAt: string;
};

export type InboundAgent = {
  id: string;
  name: string;
  description: string;
  employeeId: string | null;
  channel: "website" | "api" | "widget";
  greeting: string;
  status: "draft" | "live" | "paused";
  createdAt: string;
  updatedAt: string;
};

export type SiteRecord = {
  id: string;
  name: string;
  kind: "website" | "landing_page";
  slug: string;
  agentId: string | null;
  sourceContentId?: string | null;
  status: "draft" | "published";
  headline: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type AppRecord = {
  id: string;
  name: string;
  description: string;
  type: "workflow" | "api" | "mcp";
  employeeId: string | null;
  task: string;
  status: "draft" | "active";
  lastRunAt: string | null;
  lastRunId: string | null;
  lastOutput: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Mission = {
  id: string;
  title: string;
  description: string;
  status: "ready" | "running" | "needs_review" | "completed" | "blocked";
  priority: "low" | "normal" | "high";
  employeeId: string | null;
  sourceDocumentIds: string[];
  output: string | null;
  runId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentItem = {
  id: string;
  title: string;
  channel: "blog" | "linkedin" | "email" | "social" | "website";
  objective: string;
  status: "idea" | "draft" | "review" | "approved" | "scheduled" | "published";
  body: string;
  employeeId: string | null;
  missionId: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Playbook = {
  id: string;
  name: string;
  category: "revenue" | "delivery" | "content" | "support" | "operations";
  description: string;
  steps: string[];
  installedAt: string | null;
  lastRunAt: string | null;
};

export type OnboardingState = {
  status: "not_started" | "ready" | "proved" | "completed";
  goal: OnboardingGoal | null;
  companyUrl: string | null;
  sourceTitle: string | null;
  sourceDescription: string | null;
  discoveredAt: string | null;
  employeeId: string | null;
  employeeIds: string[];
  documentId: string | null;
  missionIds: string[];
  contentIds: string[];
  runId: string | null;
  scheduleEnabled: boolean;
  completedAt: string | null;
};

export type WorkspaceState = {
  workspace: {
    id: string;
    name: string;
    plan: "Open Source";
    aiCredits: { remaining: number; limit: number };
    dataCredits: { remaining: number; purchased: number };
    region: "LAN / Dell";
    model: string;
    onboarding: OnboardingState;
  };
  profile: WorkspaceProfile;
  members: WorkspaceMember[];
  employees: Employee[];
  documents: DocumentRecord[];
  conversations: Conversation[];
  widget: WidgetSettings;
  widgetConversations: WidgetConversation[];
  runs: Run[];
  missions: Mission[];
  content: ContentItem[];
  playbooks: Playbook[];
  lists: SmartList[];
  sequences: Sequence[];
  schedules: ScheduledWork[];
  people: PersonRecord[];
  deals: DealRecord[];
  leadSources: LeadSource[];
  campaigns: Campaign[];
  keywordMonitors: KeywordMonitor[];
  inboundAgents: InboundAgent[];
  sites: SiteRecord[];
  apps: AppRecord[];
  tickets: Ticket[];
  activity: Activity[];
  suppressedEmails: string[];
  outboundSafety: OutboundSafetySettings;
  integrations?: Array<{
    provider: string;
    status: "not_configured" | "connected" | "degraded" | "disconnected";
    accountEmail: string | null;
    scopes: string[];
    lastSyncAt: string | null;
    health?: Array<{
      status: "not_configured" | "connected" | "degraded" | "disconnected";
      eventType: string;
      detail: string;
      createdAt: string;
    }>;
  }>;
};

const now = () => new Date().toISOString();

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function createWidgetSettings(): WidgetSettings {
  return {
    enabled: false,
    publicKeyHash: null,
    employeeId: null,
    greeting: "Tell us what you are trying to accomplish. Our operator will help with the next step.",
  };
}

function defaultPlaybooks(): Playbook[] {
  return [
    {
      id: "playbook-weekly-operator-review",
      name: "Weekly operator review",
      category: "operations",
      description: "Review the workspace context, surface the most important risks, and turn them into owned work.",
      steps: [
        "Review the company profile and newest knowledge source.",
        "Identify the highest-leverage risk or opportunity.",
        "Create one owned mission with a clear next action.",
      ],
      installedAt: null,
      lastRunAt: null,
    },
    {
      id: "playbook-grounded-content-brief",
      name: "Grounded content brief",
      category: "content",
      description: "Turn real company context into an editorial brief that is ready for a human review.",
      steps: [
        "Extract one audience problem from workspace knowledge.",
        "Draft a specific point of view for the selected channel.",
        "Create a reviewable content item with its source context attached.",
      ],
      installedAt: null,
      lastRunAt: null,
    },
    {
      id: "playbook-support-triage",
      name: "Support triage",
      category: "support",
      description: "Convert unresolved customer issues into a prioritized support queue with owners and SLA awareness.",
      steps: [
        "Review open tickets and their SLA deadlines.",
        "Assign the next unresolved ticket to the support operator.",
        "Create a response mission with the missing evidence called out.",
      ],
      installedAt: null,
      lastRunAt: null,
    },
  ];
}

export function ticketSlaMinutes(priority: Ticket["priority"]) {
  return { urgent: 30, high: 120, normal: 480, low: 1440 }[priority];
}

export function dealProbability(stage: DealStage) {
  return { lead: 10, qualified: 35, proposal: 65, won: 100, lost: 0 }[stage];
}

export function createOnboardingState(status: OnboardingState["status"] = "not_started"): OnboardingState {
  return {
    status,
    goal: null,
    companyUrl: null,
    sourceTitle: null,
    sourceDescription: null,
    discoveredAt: null,
    employeeId: null,
    employeeIds: [],
    documentId: null,
    missionIds: [],
    contentIds: [],
    runId: null,
    scheduleEnabled: false,
    completedAt: null,
  };
}

export function normalizeWorkspaceState(state: WorkspaceState, companyId: string) {
  const timestamp = now();
  const legacy = state as Partial<WorkspaceState>;
  const employees = (Array.isArray(legacy.employees) ? legacy.employees : []).map((employee) => {
    const scoreTrend = Array.isArray(employee.scoreTrend) ? employee.scoreTrend : [];
    const positiveScores = scoreTrend.filter((value) => Number.isFinite(value) && value > 0);
    const tools = Array.isArray(employee.tools) ? employee.tools.filter((tool): tool is string => typeof tool === "string") : [];
    const memory = Array.isArray(employee.memory) ? employee.memory.filter((fact): fact is string => typeof fact === "string" && fact.trim().length > 0).slice(0, 100) : [];
    const knowledgeDocumentIds = Array.isArray(employee.knowledgeDocumentIds)
      ? employee.knowledgeDocumentIds.filter((documentId): documentId is string => typeof documentId === "string")
      : [];
    const temperature = typeof employee.temperature === "number" && Number.isFinite(employee.temperature)
      ? Math.min(1, Math.max(0, employee.temperature))
      : 0.35;
    const reasoning = employee.reasoning === "focused" || employee.reasoning === "deep" ? employee.reasoning : "balanced" as const;
    const normalizedEmployee = { ...employee, tools, memory, knowledgeDocumentIds, temperature, reasoning };
    if (scoreTrend[0] === 0 && positiveScores.length > 0) {
      return { ...normalizedEmployee, score: positiveScores[positiveScores.length - 1], scoreTrend: positiveScores };
    }
    return normalizedEmployee;
  });
  const documents = Array.isArray(legacy.documents) ? legacy.documents : [];
  const onboarding = {
    ...createOnboardingState(employees.length ? "completed" : "not_started"),
    ...(state.workspace.onboarding || {}),
    employeeIds: Array.isArray(state.workspace.onboarding?.employeeIds)
      ? state.workspace.onboarding.employeeIds
      : state.workspace.onboarding?.employeeId ? [state.workspace.onboarding.employeeId] : [],
    missionIds: Array.isArray(state.workspace.onboarding?.missionIds) ? state.workspace.onboarding.missionIds : [],
    contentIds: Array.isArray(state.workspace.onboarding?.contentIds) ? state.workspace.onboarding.contentIds : [],
  };
  const onboardingDocument = onboarding.documentId ? documents.find((document) => document.id === onboarding.documentId) : undefined;
  if (onboardingDocument) {
    const onboardingEmployeeIds = onboarding.employeeIds.length ? onboarding.employeeIds : onboarding.employeeId ? [onboarding.employeeId] : [];
    const sharedEmployeeIds = onboardingEmployeeIds.length ? onboardingEmployeeIds : employees.map((employee) => employee.id);
    onboardingDocument.employeeIds = [...new Set([...onboardingDocument.employeeIds, ...sharedEmployeeIds])];
    for (const employee of employees) {
      if (sharedEmployeeIds.includes(employee.id)) employee.knowledgeDocumentIds = [...new Set([...(employee.knowledgeDocumentIds || []), onboardingDocument.id])];
    }
  }
  const legacyRun = Array.isArray(legacy.runs) ? legacy.runs.find((run) => run.employeeId === employees[0]?.id) : undefined;
  const missions = Array.isArray(legacy.missions)
    ? legacy.missions
    : employees.length
      ? [{
          id: `mission-legacy-${employees[0].id}`,
          title: "Turn the workspace context into the next action",
          description: employees[0].goldenTests?.[0]?.input || "Review the workspace and propose the highest-leverage next action.",
          status: legacyRun ? "needs_review" as const : "ready" as const,
          priority: "high" as const,
          employeeId: employees[0].id,
          sourceDocumentIds: documents[0] ? [documents[0].id] : [],
          output: legacyRun?.output || null,
          runId: legacyRun?.id || null,
          dueAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }]
      : [];
  const content = Array.isArray(legacy.content)
    ? legacy.content
    : employees.length
      ? [{
          id: `content-legacy-${employees[0].id}`,
          title: "First grounded company point of view",
          channel: "linkedin" as const,
          objective: "Turn the existing workspace context into one useful, specific draft for review.",
          status: "idea" as const,
          body: "",
          employeeId: employees.find((employee) => employee.department === "Content")?.id || employees[0].id,
          missionId: missions[0]?.id || null,
          scheduledAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }]
      : [];
  const lists = (Array.isArray(state.lists) ? state.lists : []).map((list) => ({
    ...list,
    actions: Array.isArray(list.actions) ? list.actions : [],
    rows: list.rows.map((row) => ({
      ...row,
      sequenceId: row.sequenceId ?? null,
      sequenceStepIndex: Number.isInteger(row.sequenceStepIndex) ? row.sequenceStepIndex : 0,
      sequenceStatus: row.sequenceStatus ?? (row.enrollmentStatus === "replied" ? "replied" : row.enrollmentStatus === "enrolled" ? "active" : null),
      lastSentAt: row.lastSentAt ?? null,
      lastProviderMessageId: row.lastProviderMessageId ?? null,
    })),
  }));
  const deals: DealRecord[] = (Array.isArray(legacy.deals) ? legacy.deals : []).map((deal) => {
    const stage = (["lead", "qualified", "proposal", "won", "lost"] as const).includes(deal.stage as never) ? deal.stage as DealStage : "lead";
    const history = Array.isArray(deal.stageHistory) ? deal.stageHistory.filter((entry) => entry && typeof entry.stage === "string" && typeof entry.at === "string").map((entry) => ({ stage: (["lead", "qualified", "proposal", "won", "lost"] as const).includes(entry.stage as never) ? entry.stage as DealStage : stage, at: entry.at, note: typeof entry.note === "string" ? entry.note : "" })) : [];
    return {
      ...deal,
      personId: typeof deal.personId === "string" ? deal.personId : null,
      amount: Number.isFinite(deal.amount) ? Math.max(0, deal.amount) : 0,
      currency: typeof deal.currency === "string" && deal.currency.trim() ? deal.currency.toUpperCase().slice(0, 3) : "USD",
      stage,
      probability: Number.isFinite(deal.probability) ? Math.min(100, Math.max(0, deal.probability)) : dealProbability(stage),
      ownerEmployeeId: typeof deal.ownerEmployeeId === "string" ? deal.ownerEmployeeId : null,
      source: typeof deal.source === "string" && deal.source.trim() ? deal.source : "manual",
      nextAction: typeof deal.nextAction === "string" ? deal.nextAction : "",
      closeDate: typeof deal.closeDate === "string" ? deal.closeDate : null,
      notes: typeof deal.notes === "string" ? deal.notes : "",
      stageHistory: history,
    };
  });
  let sequences: Sequence[] = (Array.isArray(state.sequences) ? state.sequences : []).map((sequence) => ({
    ...sequence,
    sent: typeof sequence.sent === "number" && Number.isFinite(sequence.sent) ? sequence.sent : 0,
  }));
  if (sequences.length === 0 && employees.length > 0 && documents.length > 0 && onboarding.discoveredAt && onboarding.status !== "not_started") {
    sequences = [buildStarterSequence({
      companyId,
      companyName: state.workspace.name || companyId,
      goal: onboarding.goal || "revenue",
      deterministic: true,
    })];
  }
  const launchSurfaceReady = Boolean(onboarding.discoveredAt && employees.length && documents.length);
  const primaryEmployee = employees.find((employee) => employee.id === onboarding.employeeId) || employees[0];
  const launchId = companyId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72) || "workspace";
  const launchLists = [...lists];
  const launchAgents = Array.isArray(state.inboundAgents) ? [...state.inboundAgents] : [];
  const launchSites = Array.isArray(state.sites) ? [...state.sites] : [];
  if (launchSurfaceReady && launchLists.length === 0) {
    launchLists.push({
      id: `list-onboarding-${launchId}`,
      name: `${state.workspace.name || companyId} ideal customers`,
      description: "Import real contacts or connect a research source. Perpendicular will not invent leads or claim an email is verified without provider evidence.",
      updatedAt: timestamp,
      rows: [],
      actions: [],
    });
  }
  if (launchSurfaceReady && launchAgents.length === 0 && primaryEmployee) {
    launchAgents.push({
      id: `agent-onboarding-${launchId}`,
      name: `${state.workspace.name || companyId} website operator`,
      description: "Answer public visitors with the discovered workspace context and route every response through the selected employee.",
      employeeId: primaryEmployee.id,
      channel: "website",
      greeting: `Hi — I’m ${primaryEmployee.name}. Ask about ${state.workspace.name || companyId}, the work we do, or the next step you are considering.`,
      status: "live",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (launchSurfaceReady && launchSites.length === 0 && primaryEmployee && launchAgents[0]) {
    const slug = `${state.workspace.name || companyId}-${launchId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || `workspace-${launchId}`;
    launchSites.push({
      id: `site-onboarding-${launchId}`,
      name: `${state.workspace.name || companyId} public operator`,
      kind: "website",
      slug,
      agentId: launchAgents[0].id,
      status: "published",
      headline: `${state.workspace.name || companyId}, with a useful next step.`,
      body: `${state.profile?.description || documents[0]?.content.slice(0, 800) || "A grounded workspace operator."}\n\nThis public page is grounded in the company source discovered during setup. Ask a question to speak with the workspace operator.`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return {
    ...state,
    profile: state.profile || {
      industry: "",
      website: null,
      description: "",
      idealCustomer: "",
      goals: [],
      brandVoice: "Direct, grounded, and specific.",
      timezone: "UTC",
      updatedAt: timestamp,
    },
    members: Array.isArray(state.members) ? state.members : [],
    employees,
    documents,
    conversations: Array.isArray(state.conversations) ? state.conversations : [],
    widget: {
      ...createWidgetSettings(),
      ...(state.widget || {}),
      publicKeyHash: typeof state.widget?.publicKeyHash === "string" ? state.widget.publicKeyHash : null,
      employeeId: typeof state.widget?.employeeId === "string" ? state.widget.employeeId : null,
      greeting: typeof state.widget?.greeting === "string" && state.widget.greeting.trim() ? state.widget.greeting : createWidgetSettings().greeting,
    },
    widgetConversations: Array.isArray(state.widgetConversations) ? state.widgetConversations : [],
    runs: Array.isArray(state.runs) ? state.runs : [],
    missions,
    content,
    playbooks: Array.isArray(state.playbooks) ? state.playbooks : defaultPlaybooks(),
    lists: launchLists,
    sequences,
    schedules: Array.isArray(state.schedules) ? state.schedules.map((schedule) => ({
      ...schedule,
      activeHours: schedule.activeHours ?? null,
      weekdays: Array.isArray(schedule.weekdays) && schedule.weekdays.length ? schedule.weekdays : [0, 1, 2, 3, 4, 5, 6],
      lastOutput: schedule.lastOutput ?? null,
      runLog: Array.isArray(schedule.runLog) ? schedule.runLog.slice(0, 20) : [],
    })) : [],
    people: Array.isArray(state.people) ? state.people : [],
    deals,
    leadSources: Array.isArray(state.leadSources) ? state.leadSources.map((source) => ({
      ...source,
      listId: typeof source.listId === "string" ? source.listId : null,
      query: typeof source.query === "string" ? source.query : null,
      results: Array.isArray(source.results)
        ? source.results.filter((result) => result && typeof result.title === "string" && typeof result.url === "string" && typeof result.snippet === "string").slice(0, 10)
        : [],
      lastSummary: typeof source.lastSummary === "string" ? source.lastSummary : null,
    })) : [],
    campaigns: Array.isArray(state.campaigns) ? state.campaigns.map((campaign) => ({
      ...campaign,
      subject: typeof campaign.subject === "string" ? campaign.subject : null,
      body: typeof campaign.body === "string" ? campaign.body : null,
      lastRunAt: campaign.lastRunAt ?? null,
      lastResult: campaign.lastResult ?? null,
    })) : [],
    keywordMonitors: Array.isArray(state.keywordMonitors) ? state.keywordMonitors : [],
    inboundAgents: launchAgents,
    sites: launchSites,
    apps: Array.isArray(state.apps) ? state.apps.map((app) => ({
      ...app,
      task: typeof app.task === "string" && app.task.trim() ? app.task : app.description,
      lastRunAt: app.lastRunAt ?? null,
      lastRunId: app.lastRunId ?? null,
      lastOutput: app.lastOutput ?? null,
      lastError: app.lastError ?? null,
      runCount: Number.isFinite(app.runCount) ? app.runCount : 0,
    })) : [],
    tickets: Array.isArray(state.tickets) ? state.tickets.map((ticket) => ({
      ...ticket,
      replyDraft: typeof ticket.replyDraft === "string" ? ticket.replyDraft : null,
      replyCitations: Array.isArray(ticket.replyCitations) ? ticket.replyCitations.filter((citation): citation is string => typeof citation === "string") : [],
      requesterEmail: typeof ticket.requesterEmail === "string" ? ticket.requesterEmail : null,
      sourceProviderMessageId: typeof ticket.sourceProviderMessageId === "string" ? ticket.sourceProviderMessageId : null,
      replyProviderMessageId: typeof ticket.replyProviderMessageId === "string" ? ticket.replyProviderMessageId : null,
      replySentAt: typeof ticket.replySentAt === "string" ? ticket.replySentAt : null,
    })) : [],
    activity: Array.isArray(state.activity) ? state.activity : [],
    suppressedEmails: Array.isArray(state.suppressedEmails) ? state.suppressedEmails.map((email) => email.toLowerCase()) : [],
    outboundSafety: normalizeOutboundSafetySettings(state.outboundSafety),
    workspace: {
      ...state.workspace,
      id: state.workspace.id || companyId,
      onboarding,
    },
  };
}

function createEmptyState(companyId: string): WorkspaceState {
  const aiCredits = Number(process.env.INITIAL_AI_CREDITS || 1000);
  const dataCredits = Number(process.env.INITIAL_DATA_CREDITS || 500);
  return {
    workspace: {
      id: companyId,
      name: companyId,
      plan: "Open Source",
      aiCredits: { remaining: aiCredits, limit: aiCredits },
      dataCredits: { remaining: dataCredits, purchased: dataCredits },
      region: "LAN / Dell",
      model: process.env.OLLAMA_MODEL ? `Ollama · ${process.env.OLLAMA_MODEL}` : "Ollama · not configured",
      onboarding: createOnboardingState(),
    },
    profile: {
      industry: "",
      website: null,
      description: "",
      idealCustomer: "",
      goals: [],
      brandVoice: "Direct, grounded, and specific.",
      timezone: "UTC",
      updatedAt: now(),
    },
    members: [],
    employees: [],
    documents: [],
    conversations: [],
    widget: createWidgetSettings(),
    widgetConversations: [],
    runs: [],
    missions: [],
    content: [],
    playbooks: defaultPlaybooks(),
    lists: [],
    sequences: [],
    schedules: [],
    people: [],
    deals: [],
    leadSources: [],
    campaigns: [],
    keywordMonitors: [],
    inboundAgents: [],
    sites: [],
    apps: [],
    tickets: [],
    activity: [],
    suppressedEmails: [],
    outboundSafety: defaultOutboundSafetySettings(),
    integrations: [],
  };
}

export function createInitialState(companyId = "blueblood-demo"): WorkspaceState {
  if (process.env.NODE_ENV === "production") return createEmptyState(companyId);
  const seed = createEmptyState(companyId);
  const timestamp = now();
  const atlas: Employee = {
    id: "emp-atlas",
    name: "Atlas",
    title: "Growth Intelligence Lead",
    department: "Growth",
    avatar: "AT",
    systemPrompt:
      "You are Atlas, a sharp growth intelligence lead. Turn messy market signals into clear decisions, cite the workspace knowledge, and always end with a next action.",
    model: "qwen2.5:3b · local",
    status: "live",
    memoryScope: "company",
    score: 92,
    scoreTrend: [78, 83, 81, 87, 90, 89, 92],
    lastRunAt: timestamp,
    schedule: {
      enabled: true,
      cadence: "daily",
      task: "Scan the pipeline for stalled opportunities and write the three highest-leverage next actions.",
      nextRunAt: new Date(Date.now() + 1000 * 60 * 60 * 18).toISOString(),
    },
    promptVersions: [
      {
        id: "pv-atlas-2",
        version: 2,
        prompt:
          "You are Atlas, a sharp growth intelligence lead. Turn messy market signals into clear decisions, cite the workspace knowledge, and always end with a next action.",
        author: "Manan",
        createdAt: timestamp,
        note: "Added explicit next-action requirement after eval drift.",
        active: true,
      },
      {
        id: "pv-atlas-1",
        version: 1,
        prompt: "You are a growth intelligence lead. Summarize market signals for the team.",
        author: "System",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
        note: "Initial role prompt.",
        active: false,
      },
    ],
    goldenTests: [
      { id: "gt-1", input: "Which stalled lead should we rescue first?", expected: "Prioritized action with evidence", lastScore: 94 },
      { id: "gt-2", input: "Give me a concise ICP signal report.", expected: "Cited signal summary and next step", lastScore: 91 },
      { id: "gt-3", input: "What should the founder do before Friday?", expected: "Three concrete actions", lastScore: 90 },
    ],
  };

  const nova: Employee = {
    id: "emp-nova",
    name: "Nova",
    title: "Brand Voice Editor",
    department: "Content",
    avatar: "NO",
    systemPrompt:
      "You are Nova, a precise brand voice editor. Make writing feel human, useful, and specific. Flag claims that lack evidence and avoid empty hype.",
    model: "qwen2.5:3b · local",
    status: "live",
    memoryScope: "company",
    score: 88,
    scoreTrend: [75, 77, 80, 84, 83, 86, 88],
    lastRunAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    schedule: null,
    promptVersions: [
      {
        id: "pv-nova-1",
        version: 1,
        prompt:
          "You are Nova, a precise brand voice editor. Make writing feel human, useful, and specific. Flag claims that lack evidence and avoid empty hype.",
        author: "Manan",
        createdAt: timestamp,
        note: "Initial role prompt.",
        active: true,
      },
    ],
    goldenTests: [
      { id: "gt-4", input: "Rewrite this launch note without hype.", expected: "Specific, grounded rewrite", lastScore: 89 },
      { id: "gt-5", input: "What claim needs proof?", expected: "Clear claim-risk callout", lastScore: 87 },
    ],
  };

  const rhea: Employee = {
    id: "emp-rhea",
    name: "Rhea",
    title: "Customer Support Operator",
    department: "Support",
    avatar: "RH",
    systemPrompt:
      "You are Rhea, a calm customer support operator. Resolve what you can from the knowledge base, ask one useful question when blocked, and escalate with context when urgency is high.",
    model: "qwen2.5:3b · local",
    status: "paused",
    memoryScope: "employee",
    score: 84,
    scoreTrend: [81, 82, 80, 84, 83, 84, 84],
    lastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    schedule: null,
    promptVersions: [
      {
        id: "pv-rhea-1",
        version: 1,
        prompt:
          "You are Rhea, a calm customer support operator. Resolve what you can from the knowledge base, ask one useful question when blocked, and escalate with context when urgency is high.",
        author: "Manan",
        createdAt: timestamp,
        note: "Initial role prompt.",
        active: true,
      },
    ],
    goldenTests: [{ id: "gt-6", input: "A customer is frustrated about a delayed order.", expected: "Empathy, status, and escalation path", lastScore: 84 }],
  };

  const employees = [atlas, nova, rhea];
  return {
    ...seed,
    workspace: {
      ...seed.workspace,
      id: companyId,
      name: "Blueblood Studio",
      onboarding: {
        ...createOnboardingState("completed"),
        goal: "revenue",
        companyUrl: "https://bluebloodstudio.com",
        sourceTitle: "Blueblood ICP & Positioning",
        sourceDescription: "Demo workspace seeded for local development.",
        discoveredAt: timestamp,
        employeeId: atlas.id,
        employeeIds: employees.map((employee) => employee.id),
        documentId: "doc-icp",
        missionIds: ["mission-pipeline", "mission-content", "mission-support"],
        contentIds: ["content-positioning"],
        runId: "run-atlas-1",
        scheduleEnabled: true,
        completedAt: timestamp,
      },
    },
    profile: {
      industry: "Digital product studio",
      website: "https://bluebloodstudio.com",
      description: "Blueblood Studio builds AI-first digital products for ambitious teams.",
      idealCustomer: "AI-first SaaS, D2C brands, and premium digital agencies.",
      goals: ["Create reliable growth follow-through", "Ship grounded content", "Keep delivery visible"],
      brandVoice: "Direct, grounded, and concrete. Avoid vague transformation language.",
      timezone: "Asia/Kolkata",
      updatedAt: timestamp,
    },
    employees,
    documents: [
      {
        id: "doc-icp",
        name: "Blueblood ICP & Positioning",
        source: "playbook",
        content:
          "Blueblood Studio serves AI-first SaaS, D2C brands, and premium digital agencies. Buyers care about speed, proof, a strong point of view, and production reliability. Avoid vague transformation language. Lead with the measurable workflow outcome.",
        status: "ready",
        chunks: 8,
        updatedAt: timestamp,
        employeeIds: employees.map((employee) => employee.id),
      },
      {
        id: "doc-gtm",
        name: "Sell & Support Operating Notes",
        source: "upload",
        content:
          "The wedge is deeper follow-through: deliverability, attribution, ticket SLAs, prompt versioning, golden evals, and auditability. Never send an outbound message without a suppression check. Escalate urgent support tickets inside the SLA window.",
        status: "ready",
        chunks: 6,
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
        employeeIds: [atlas.id, rhea.id],
      },
      {
        id: "doc-voice",
        name: "Voice & Claim Guardrails",
        source: "url",
        content:
          "Write like a smart operator: direct, grounded, and concrete. Do not claim customer counts, certifications, or model availability without a source. Separate GA models from preview models. Every recommendation needs an owner and a next move.",
        status: "ready",
        chunks: 5,
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
        employeeIds: [atlas.id, nova.id],
      },
    ],
    conversations: [
      {
        id: "conv-atlas",
        employeeId: atlas.id,
        messages: [
          {
            id: "msg-seed",
            role: "assistant",
            content: "Ready. I have the ICP and operating notes loaded. Ask me about the pipeline, positioning, or what needs to happen next.",
            createdAt: timestamp,
            citations: ["Blueblood ICP & Positioning", "Sell & Support Operating Notes"],
          },
        ],
      },
    ],
    runs: [
      {
        id: "run-atlas-1",
        employeeId: atlas.id,
        trigger: "heartbeat",
        task: "Scan the pipeline for stalled opportunities and write the three highest-leverage next actions.",
        output: "Meridian is the highest-leverage rescue: strong fit, no activity in 9 days, and a clear proof point from the positioning notes. Next: send the founder a two-line teardown, then offer a 20-minute working session. Owner: Manan.",
        score: 92,
        reason: "Cited the right source, prioritized one opportunity, and ended with a concrete owner + next action.",
        status: "completed",
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
        durationMs: 1840,
        trace: [
          { label: "Memory", detail: "Loaded yesterday's heartbeat log", durationMs: 14, cost: 0, status: "complete" },
          { label: "Knowledge", detail: "Retrieved 2 relevant docs · 5 chunks", durationMs: 42, cost: 0, status: "complete" },
          { label: "Worker", detail: "Ollama · qwen2.5:3b", durationMs: 1620, cost: 1, status: "complete" },
          { label: "Evaluator", detail: "Golden rubric · 3 checks", durationMs: 164, cost: 1, status: "complete" },
        ],
      },
      {
        id: "run-nova-1",
        employeeId: nova.id,
        trigger: "manual",
        task: "Rewrite the homepage promise so it feels credible and specific.",
        output: "Build the growth system your team can actually run. Perpendicular keeps the employee, the knowledge, and the follow-through in one visible loop.",
        score: 88,
        reason: "Clear and grounded. Could be stronger with one measurable outcome.",
        status: "completed",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        durationMs: 2160,
        trace: [
          { label: "Knowledge", detail: "Retrieved 2 relevant docs · 4 chunks", durationMs: 35, cost: 0, status: "complete" },
          { label: "Worker", detail: "Ollama · qwen2.5:3b", durationMs: 1950, cost: 1, status: "complete" },
          { label: "Evaluator", detail: "Tone rubric · 3 checks", durationMs: 175, cost: 1, status: "complete" },
        ],
      },
    ],
    missions: [
      {
        id: "mission-pipeline",
        title: "Rescue the highest-fit opportunity",
        description: "Review the current pipeline context and propose the next action for the account with the clearest buying signal.",
        status: "needs_review",
        priority: "high",
        employeeId: atlas.id,
        sourceDocumentIds: ["doc-icp", "doc-gtm"],
        output: "Meridian is the highest-leverage rescue. Next: send the founder a two-line teardown and offer a 20-minute working session.",
        runId: "run-atlas-1",
        dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      },
      {
        id: "mission-content",
        title: "Turn the positioning into one useful post",
        description: "Draft a specific point of view about reliable AI product delivery, using the workspace voice and evidence.",
        status: "ready",
        priority: "normal",
        employeeId: nova.id,
        sourceDocumentIds: ["doc-icp", "doc-voice"],
        output: null,
        runId: null,
        dueAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "mission-support",
        title: "Close the open support loop",
        description: "Review the highest-priority open ticket, identify the missing evidence, and write the next customer update.",
        status: "ready",
        priority: "high",
        employeeId: rhea.id,
        sourceDocumentIds: ["doc-gtm"],
        output: null,
        runId: null,
        dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    content: [
      {
        id: "content-positioning",
        title: "Reliable AI delivery is a workflow problem",
        channel: "linkedin",
        objective: "Create a grounded point of view for AI-first product teams.",
        status: "review",
        body: "Build the growth system your team can actually run. The strongest advantage is not another promise; it is visible follow-through from context to owner to next action.",
        employeeId: nova.id,
        missionId: "mission-content",
        scheduledAt: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      },
    ],
    playbooks: defaultPlaybooks().map((playbook) => ({ ...playbook, installedAt: timestamp })),
    lists: [
      {
        id: "list-growth",
        name: "AI-first agency founders",
        description: "Founder-led teams with a visible follow-through problem.",
        updatedAt: timestamp,
        rows: [
          {
            id: "row-meridian",
            name: "Sana Kapoor",
            email: "sana@meridianlabs.co",
            company: "Meridian Labs",
            role: "Founder",
            location: "Bengaluru, IN",
            score: 94,
            status: "enriched",
            emailStatus: "verified",
            intent: "Hiring for growth",
            companyInsight: "Series B · 18-person GTM team · no lifecycle owner",
            enrollmentStatus: "enrolled",
            lastAction: "Enrolled in Founder Follow-through",
          },
          {
            id: "row-kite",
            name: "Arjun Rao",
            email: "arjun@kiteworks.dev",
            company: "Kiteworks",
            role: "Co-founder",
            location: "Pune, IN",
            score: 87,
            status: "enriched",
            emailStatus: "verified",
            intent: "Launching outbound",
            companyInsight: "Bootstrapped · strong product signal · founder still owns sales",
            enrollmentStatus: "not enrolled",
            lastAction: "Enriched from public company evidence",
          },
          {
            id: "row-loom",
            name: "Mia Chen",
            email: "mia@loomnorth.com",
            company: "Loom North",
            role: "Head of Marketing",
            location: "Austin, US",
            score: 76,
            status: "new",
            emailStatus: "unknown",
            intent: "Content backlog",
            companyInsight: "Content hiring signal detected",
            enrollmentStatus: "not enrolled",
            lastAction: null,
          },
          {
            id: "row-frame",
            name: "Noah Williams",
            email: "noah@frameos.com",
            company: "FrameOS",
            role: "Revenue Lead",
            location: "London, UK",
            score: 68,
            status: "new",
            emailStatus: "unknown",
            intent: "CRM migration",
            companyInsight: "No verified buying signal yet",
            enrollmentStatus: "not enrolled",
            lastAction: null,
          },
        ],
      },
    ],
    sequences: [
      {
        id: "seq-founder",
        name: "Founder Follow-through",
        status: "live",
        audience: "AI-first agency founders",
        enrolled: 42,
        replied: 11,
        booked: 4,
        steps: [
          { id: "step-1", channel: "Email", title: "Specific teardown", delay: "Day 0", body: "{{firstName}}, noticed {{companyName}} is building without a lifecycle owner. I mapped the first three follow-through leaks." },
          { id: "step-2", channel: "LinkedIn", title: "Useful follow-up", delay: "Day 3", body: "Share one insight from the teardown. Stop if the lead replies or unsubscribes." },
          { id: "step-3", channel: "Email", title: "Breakup with proof", delay: "Day 7", body: "Close the loop with one concrete benchmark and a low-friction working session." },
        ],
      },
      {
        id: "seq-content",
        name: "Content Ops Audit",
        status: "draft",
        audience: "Heads of Marketing",
        enrolled: 0,
        replied: 0,
        booked: 0,
        steps: [
          { id: "step-4", channel: "Email", title: "Audit prompt", delay: "Day 0", body: "Offer a 15-minute audit of the content approval loop." },
        ],
      },
    ],
    tickets: [
      {
        id: "ticket-1042",
        subject: "Lead import stopped after 200 rows",
        requester: "Kiteworks team",
        message: "The list run says it completed, but only 200 of 500 rows have an action result. Can you tell us what happened?",
        priority: "high",
        status: "open",
        createdAt: new Date(Date.now() - 1000 * 60 * 46).toISOString(),
        slaDueAt: new Date(Date.now() + 1000 * 60 * 74).toISOString(),
        assignee: "Rhea",
        csat: null,
      },
      {
        id: "ticket-1041",
        subject: "Where did our score drop come from?",
        requester: "Meridian Labs",
        message: "The last scheduled run is 12 points lower. We need the reason before tomorrow's send.",
        priority: "urgent",
        status: "pending",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        slaDueAt: new Date(Date.now() - 1000 * 60 * 26).toISOString(),
        assignee: "Atlas",
        csat: null,
      },
      {
        id: "ticket-1037",
        subject: "Add our positioning doc to Nova",
        requester: "Blueblood Studio",
        message: "The new positioning notes should be visible to the content employee.",
        priority: "normal",
        status: "resolved",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(),
        slaDueAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
        assignee: "Nova",
        csat: 5,
      },
    ],
    activity: [
      { id: "act-1", type: "run", title: "Atlas completed a heartbeat", detail: "Score 92 · stalled pipeline scan", createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString() },
      { id: "act-2", type: "lead", title: "Sana Kapoor was enrolled", detail: "Founder Follow-through · verified email", createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString() },
      { id: "act-3", type: "ticket", title: "Ticket #1042 needs attention", detail: "High priority · SLA in 74 min", createdAt: new Date(Date.now() - 1000 * 60 * 46).toISOString() },
      { id: "act-4", type: "system", title: "Knowledge index is healthy", detail: "3 docs · 19 chunks · 3 employees", createdAt: new Date(Date.now() - 1000 * 60 * 70).toISOString() },
      { id: "act-5", type: "employee", title: "Nova prompt v1 published", detail: "Brand guardrails loaded", createdAt: new Date(Date.now() - 1000 * 60 * 95).toISOString() },
    ],
    integrations: [],
  };
}

export function findRelevantDocuments(documents: DocumentRecord[], query: string) {
  const stopwords = new Set([
    "about", "after", "again", "also", "and", "are", "can", "does", "for", "from", "has", "have", "how", "into", "is", "its", "more", "our", "that", "the", "their", "this", "what", "when", "where", "which", "who", "why", "with", "you", "your",
  ]);
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !stopwords.has(term)))];
  const ranked = [...documents]
    .map((document) => {
      const haystack = `${document.name} ${document.content}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { document, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(({ score }) => score > 0);
  if (ranked.length > 0) return ranked.slice(0, 3).map(({ document }) => document);
  return documents.slice(0, 1);
}

export function scoreRun(task: string, output: string) {
  let score = 70;
  if (output.length > 140) score += 5;
  if (/next|owner|action/i.test(output)) score += 8;
  if (/because|evidence|source|cited/i.test(output)) score += 7;
  if (/\d/.test(output)) score += 3;
  if (task.length > 45) score += 2;
  return Math.min(98, score);
}

export function recordEmployeeScore(employee: Pick<Employee, "score" | "scoreTrend">, score: number) {
  const boundedScore = Math.min(100, Math.max(0, Math.round(score)));
  const hasHistory = employee.score > 0 || employee.scoreTrend.some((value) => value > 0);
  employee.score = hasHistory ? Math.round((employee.score * 0.65) + (boundedScore * 0.35)) : boundedScore;
  employee.scoreTrend = [...employee.scoreTrend.filter((value) => value > 0).slice(-6), boundedScore];
}

export function buildFallbackReply(employee: Employee, message: string, documents: DocumentRecord[]) {
  const relevant = findRelevantDocuments(documents, message);
  const citations = relevant.length > 0 ? relevant.map((document) => document.name) : ["Employee system prompt"];
  const lower = message.toLowerCase();
  const context = relevant.length > 0 ? ` I grounded this in ${relevant.map((document) => `“${document.name}”`).join(" and ")}.` : " I did not find a matching workspace source, so treat this as a working hypothesis.";

  if (/\b(?:what(?:'s| is)|tell me about)\s+(?:this\s+)?(?:platform|app|product)\b|\bwhat\s+is\s+perpendicular\b/i.test(lower)) {
    return {
      content: `Perpendicular is an open-source work system for turning company context into owned, reviewable work. It gives you local AI employees, a knowledge base, missions, content drafts, Smart Lists, controlled Gmail sequences, support inboxes, and a website operator. The Dell runs the durable API, Postgres, and Ollama model; the browser is the control surface.${context} Next action: open Missions and run the first owned item, then review the result before approving it.`,
      citations,
    };
  }

  if (employee.department === "Growth" || /lead|pipeline|growth|market|sales|prospect/i.test(lower)) {
    return {
      content: `The clearest move is to prioritize the highest-fit opportunity with a recent buying signal, then give them one useful artifact before asking for time. Start with a short teardown tied to their current bottleneck, assign the follow-up to one owner, and pause the sequence if they reply.${context} Next action: pick one account, write the proof point, and send it today.`,
      citations,
    };
  }

  if (employee.department === "Content" || /write|content|copy|launch|brand|rewrite/i.test(lower)) {
    return {
      content: `Make the claim smaller and the evidence sharper. Lead with the workflow outcome, name who owns the next step, and cut any promise that cannot be verified. Keep one memorable phrase, then support it with a concrete example.${context} Next action: publish the grounded version and log the claim that still needs proof.`,
      citations,
    };
  }

  if (employee.department === "Support" || /support|customer|ticket|frustrat|issue/i.test(lower)) {
    return {
      content: `Acknowledge the impact first, state what is known, and give the customer the next checkpoint. If the issue is blocked by a missing system event, escalate with the ticket ID, current owner, and SLA deadline instead of asking the customer to repeat themselves.${context} Next action: attach the trace to the ticket and set the next update time.`,
      citations,
    };
  }

  return {
    content: `I can take this from a vague request to an executable next step. I would use the workspace context, state what is known, call out the missing evidence, and finish with one owner and one deadline.${context} Next action: tell me the decision you need to make and I will turn it into a short runbook.`,
    citations,
  };
}

export function addActivity(state: WorkspaceState, activity: Omit<Activity, "id" | "createdAt">) {
  state.activity.unshift({ ...activity, id: id("act"), createdAt: now() });
  state.activity = state.activity.slice(0, 40);
}

export function createId(prefix: string) {
  return id(prefix);
}

export function timestamp() {
  return now();
}

export type OnboardingDiscovery = {
  url: string | null;
  title: string | null;
  description: string | null;
  text: string;
};

const onboardingGoalDetails: Record<OnboardingGoal, { title: string; department: Department; name: string; task: string; expected: string }> = {
  revenue: {
    title: "Revenue Operator",
    department: "Growth",
    name: "Orbit",
    task: "Review the discovered company context and propose the three highest-leverage revenue actions for this week.",
    expected: "Grounded revenue priorities with owners and next actions",
  },
  delivery: {
    title: "Delivery Operator",
    department: "Operations",
    name: "Relay",
    task: "Review the discovered company context and propose the three highest-leverage delivery actions for this week.",
    expected: "Grounded delivery priorities with owners and next actions",
  },
  content: {
    title: "Content Operator",
    department: "Content",
    name: "Signal",
    task: "Review the discovered company context and propose the three highest-leverage content actions for this week.",
    expected: "Grounded content priorities with owners and next actions",
  },
  support: {
    title: "Support Operator",
    department: "Support",
    name: "Harbor",
    task: "Review the discovered company context and propose the three highest-leverage support actions for this week.",
    expected: "Grounded support priorities with owners and next actions",
  },
};

export function onboardingGoalDetailsFor(goal: OnboardingGoal) {
  return onboardingGoalDetails[goal];
}

export function buildStarterSequence(args: {
  companyId: string;
  companyName: string;
  goal: OnboardingGoal;
  deterministic?: boolean;
}): Sequence {
  const companyName = args.companyName.trim() || "your company";
  const prefix = args.deterministic
    ? `seq-onboarding-${args.companyId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72) || "workspace"}`
    : createId("seq");
  const stepId = (number: number) => args.deterministic ? `${prefix}-step-${number}` : createId("step");
  return {
    id: prefix,
    name: `${companyName} first conversation`,
    status: "draft",
    audience: "Ideal customer profile from company discovery",
    enrolled: 0,
    sent: 0,
    replied: 0,
    booked: 0,
    steps: [
      { id: stepId(1), channel: "Email", title: "Specific observation", delay: "Day 0", subject: `A useful observation about {{companyName}}`, body: `Hi {{firstName}} — I noticed {{companyName}} may be working through a problem related to ${args.goal}. I wrote down one specific observation from the public context. If it is useful, I can send it over.` },
      { id: stepId(2), channel: "Email", title: "Useful follow-up", delay: "Day 3", subject: "One practical follow-up", body: "Sharing the smallest useful next step, not a generic pitch. I will pause if this is not relevant." },
      { id: stepId(3), channel: "Task", title: "Review reply", delay: "Day 5", body: "Review any reply, attach the evidence, and decide whether to continue or suppress the contact." },
      { id: stepId(4), channel: "Email", title: "Proof point", delay: "Day 7", subject: "The proof point", body: "Close the loop with one concrete proof point from the workspace and a low-friction next step." },
      { id: stepId(5), channel: "Email", title: "Final nudge", delay: "Day 10", subject: "Should I close the loop?", body: "A final, respectful check-in. Stop the sequence if the contact replies or asks not to be contacted." },
    ],
  };
}

export function buildOnboardingArtifacts(args: {
  companyId: string;
  companyName: string;
  goal: OnboardingGoal;
  discovery: OnboardingDiscovery;
  createdAt?: string;
}) {
  const createdAt = args.createdAt || timestamp();
  const goalDetails = onboardingGoalDetails[args.goal];
  const sourceName = args.discovery.title ? `Company discovery · ${args.discovery.title}` : `Company discovery · ${args.companyName}`;
  const sourceDescription = args.discovery.description || `Public company context discovered for ${args.companyName}.`;
  const document: DocumentRecord = {
    id: createId("doc"),
    name: sourceName.slice(0, 140),
    source: args.discovery.url ? "url" : "upload",
    content: args.discovery.text.slice(0, 100000),
    status: "ready",
    chunks: Math.max(1, Math.ceil(args.discovery.text.length / 240)),
    updatedAt: createdAt,
    employeeIds: [],
  };
  const roleTemplates: Array<{ name: string; title: string; department: Department; task: string; expected: string; tools: string[] }> = [
    {
      name: "Scout",
      title: "Research Operator",
      department: "Growth",
      task: "Extract the strongest customer, market, or buying signal from the discovered company context and explain what evidence is still missing.",
      expected: "Evidence-backed signal with a clear next action",
      tools: ["workspace_search", "public_research", "mission_write"],
    },
    {
      name: "Signal",
      title: "Content Operator",
      department: "Content",
      task: "Turn the discovered company context into one specific content angle that would be useful to the ideal customer.",
      expected: "Grounded content angle with proof requirements",
      tools: ["workspace_search", "content_draft", "mission_write"],
    },
    {
      name: "Relay",
      title: "Delivery Operator",
      department: "Operations",
      task: "Review the discovered company context and propose the three highest-leverage delivery actions for this week.",
      expected: "Grounded delivery priorities with owners and next actions",
      tools: ["workspace_search", "mission_write", "schedule"],
    },
    {
      name: "Harbor",
      title: "Support Operator",
      department: "Support",
      task: "Review the discovered company context and identify the customer experience risk that deserves the fastest response.",
      expected: "Support risk with an owner, SLA, and next action",
      tools: ["workspace_search", "ticket_read", "mission_write"],
    },
  ];
  const primary: Employee = {
    id: createId("emp"),
    name: goalDetails.name,
    title: goalDetails.title,
    department: goalDetails.department,
    avatar: goalDetails.name.slice(0, 2).toUpperCase(),
    systemPrompt: [
      `You are ${goalDetails.name}, the ${goalDetails.title} for ${args.companyName}.`,
      `Your job is to improve ${args.goal} outcomes using only the workspace context.`,
      "Separate facts from assumptions, cite the source by name, and finish every response with one owner and one next action.",
    ].join(" "),
    model: process.env.OLLAMA_MODEL ? `Ollama · ${process.env.OLLAMA_MODEL}` : "Ollama · not configured",
    status: "live",
    memoryScope: "company",
    tools: ["workspace_search", "mission_write", "profile_read"],
    knowledgeDocumentIds: [],
    temperature: 0.35,
    reasoning: "balanced",
    locked: false,
    score: 0,
    scoreTrend: [0],
    lastRunAt: null,
    schedule: null,
    promptVersions: [{ id: createId("pv"), version: 1, prompt: "", author: "Perpendicular onboarding", createdAt, note: "Created from live workspace discovery.", active: true }],
    goldenTests: [{ id: createId("gt"), input: goalDetails.task, expected: goalDetails.expected, lastScore: 0 }],
  };
  primary.promptVersions[0].prompt = primary.systemPrompt;
  const employees = [primary, ...roleTemplates.filter((role) => role.department !== primary.department).map((role) => {
    const prompt = [
      `You are ${role.name}, the ${role.title} for ${args.companyName}.`,
      `Your job is to support ${args.goal} outcomes using only the workspace context.`,
      "Separate facts from assumptions, cite the source by name, and finish every response with one owner and one next action.",
    ].join(" ");
    return {
      id: createId("emp"),
      name: role.name,
      title: role.title,
      department: role.department,
      avatar: role.name.slice(0, 2).toUpperCase(),
      systemPrompt: prompt,
      model: process.env.OLLAMA_MODEL ? `Ollama · ${process.env.OLLAMA_MODEL}` : "Ollama · not configured",
      status: "live" as const,
      memoryScope: "company" as const,
      tools: role.tools,
      knowledgeDocumentIds: [] as string[],
      temperature: 0.35,
      reasoning: "balanced" as const,
      locked: false,
      score: 0,
      scoreTrend: [0],
      lastRunAt: null,
      schedule: null,
      promptVersions: [{ id: createId("pv"), version: 1, prompt, author: "Perpendicular onboarding", createdAt, note: "Created from live workspace discovery.", active: true }],
      goldenTests: [{ id: createId("gt"), input: role.task, expected: role.expected, lastScore: 0 }],
    } satisfies Employee;
  })];
  document.employeeIds = employees.map((employee) => employee.id);
  for (const employee of employees) employee.knowledgeDocumentIds = [document.id];
  const missions: Mission[] = employees.map((employee, index) => {
    const role = employee.id === primary.id
      ? { title: `Set the first ${args.goal} priority`, description: goalDetails.task, priority: "high" as const }
      : (() => {
          const template = roleTemplates.find((item) => item.department === employee.department);
          return template
            ? { title: template.title, description: template.task, priority: "normal" as const }
            : { title: `Review ${employee.department.toLowerCase()}`, description: employee.goldenTests[0]?.input || "Review the workspace and propose the next action.", priority: "normal" as const };
        })();
    return {
      id: createId("mission"),
      title: role.title,
      description: role.description,
      status: "ready" as const,
      priority: role.priority,
      employeeId: employee.id,
      sourceDocumentIds: [document.id],
      output: null,
      runId: null,
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * (index === 0 ? 24 : 72)).toISOString(),
      createdAt,
      updatedAt: createdAt,
    };
  });
  const contentEmployee = employees.find((employee) => employee.department === "Content") || primary;
  const contentBriefs: Array<Pick<ContentItem, "title" | "channel" | "objective">> = [
    { title: `First ${args.companyName} point of view`, channel: "linkedin", objective: "Turn the real company context into one useful, specific point of view for the ideal customer." },
    { title: `${args.companyName} customer problem brief`, channel: "blog", objective: "Explain one concrete customer problem from the discovered context, the cost of leaving it unresolved, and a grounded way to think about it." },
    { title: `${args.companyName} welcome page`, channel: "website", objective: "Create a clear website page that explains what the company does, who it helps, and the next useful step without inventing proof." },
  ];
  const content: ContentItem[] = contentBriefs.map((brief) => ({
    id: createId("content"),
    ...brief,
    status: "idea",
    body: "",
    employeeId: contentEmployee.id,
    missionId: missions.find((mission) => mission.employeeId === contentEmployee.id)?.id || null,
    scheduledAt: null,
    createdAt,
    updatedAt: createdAt,
  }));
  const sequence: Sequence = {
    id: createId("seq"),
    name: `${args.companyName} first conversation`,
    status: "draft",
    audience: "Ideal customer profile from company discovery",
    enrolled: 0,
    sent: 0,
    replied: 0,
    booked: 0,
    steps: [
      { id: createId("step"), channel: "Email", title: "Specific observation", delay: "Day 0", subject: `A useful observation about {{companyName}}`, body: `Hi {{firstName}} — I noticed {{companyName}} may be working through a problem related to ${args.goal}. I wrote down one specific observation from the public context. If it is useful, I can send it over.` },
      { id: createId("step"), channel: "Email", title: "Useful follow-up", delay: "Day 3", subject: "One practical follow-up", body: "Sharing the smallest useful next step, not a generic pitch. I will pause if this is not relevant." },
      { id: createId("step"), channel: "Task", title: "Review reply", delay: "Day 5", body: "Review any reply, attach the evidence, and decide whether to continue or suppress the contact." },
      { id: createId("step"), channel: "Email", title: "Proof point", delay: "Day 7", subject: "The proof point", body: "Close the loop with one concrete proof point from the workspace and a low-friction next step." },
      { id: createId("step"), channel: "Email", title: "Final nudge", delay: "Day 10", subject: "Should I close the loop?", body: "A final, respectful check-in. Stop the sequence if the contact replies or asks not to be contacted." },
    ],
  };
  const list: SmartList = {
    id: createId("list"),
    name: `${args.companyName} ideal customers`,
    description: "Import real contacts or connect a research source. Perpendicular will not invent leads or claim an email is verified without provider evidence.",
    updatedAt: createdAt,
    rows: [],
    actions: [],
  };
  const leadSource: LeadSource = {
    id: createId("source"),
    name: `${args.companyName} public research`,
    type: "public",
    listId: list.id,
    query: `${args.companyName} ${args.goal}`,
    results: [],
    status: "ready",
    recordCount: 0,
    lastRunAt: null,
    lastSummary: "Ready to run a public search. Results are saved here for review; no contact or email is invented.",
    createdAt,
  };
  const inboundAgent: InboundAgent = {
    id: createId("agent"),
    name: `${args.companyName} website operator`,
    description: "Answer public visitors with the discovered workspace context and route every response through the selected employee.",
    employeeId: primary.id,
    channel: "website",
    greeting: `Hi — I’m ${primary.name}. Ask about ${args.companyName}, the work we do, or the next step you are considering.`,
    status: "live",
    createdAt,
    updatedAt: createdAt,
  };
  const siteSlug = `${args.companyName}-${args.companyId}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || createId("site");
  const site: SiteRecord = {
    id: createId("site"),
    name: `${args.companyName} public operator`,
    kind: "website",
    slug: siteSlug,
    agentId: inboundAgent.id,
    status: "published",
    headline: `${args.companyName}, with a useful next step.`,
    body: `${sourceDescription}\n\nThis public page is grounded in the company source discovered during setup. Ask a question to speak with the workspace operator.`,
    createdAt,
    updatedAt: createdAt,
  };
  const profile: WorkspaceProfile = {
    industry: "To be confirmed from company context",
    website: args.discovery.url,
    description: sourceDescription,
    idealCustomer: "To be confirmed. Ask the system to refine this from your source.",
    goals: [goalDetails.task],
    brandVoice: "Direct, grounded, and specific. Separate facts from assumptions.",
    timezone: process.env.DEFAULT_TIMEZONE || "UTC",
    updatedAt: createdAt,
  };
  return {
    employee: primary,
    employees,
    document,
    missions,
    content,
    sequence,
    list,
    leadSource,
    inboundAgent,
    site,
    profile,
    playbooks: defaultPlaybooks(),
    task: goalDetails.task,
    sourceDescription,
  };
}
