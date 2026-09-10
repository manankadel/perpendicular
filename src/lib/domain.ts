import crypto from "node:crypto";

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
  status: "new" | "enriched";
  emailStatus: "unknown" | "verified" | "risky";
  intent: string;
  companyInsight: string;
  enrollmentStatus: "not enrolled" | "enrolled" | "replied";
  lastAction: string | null;
};

export type SmartList = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rows: SmartRow[];
};

export type Sequence = {
  id: string;
  name: string;
  status: "live" | "draft";
  audience: string;
  enrolled: number;
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
};

export type Activity = {
  id: string;
  type: "employee" | "run" | "lead" | "sequence" | "ticket" | "system";
  title: string;
  detail: string;
  createdAt: string;
};

export type OnboardingGoal = "revenue" | "delivery" | "content" | "support";

export type OnboardingState = {
  status: "not_started" | "ready" | "completed";
  goal: OnboardingGoal | null;
  companyUrl: string | null;
  sourceTitle: string | null;
  sourceDescription: string | null;
  discoveredAt: string | null;
  employeeId: string | null;
  documentId: string | null;
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
  employees: Employee[];
  documents: DocumentRecord[];
  conversations: Conversation[];
  runs: Run[];
  lists: SmartList[];
  sequences: Sequence[];
  tickets: Ticket[];
  activity: Activity[];
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

export function createOnboardingState(status: OnboardingState["status"] = "not_started"): OnboardingState {
  return {
    status,
    goal: null,
    companyUrl: null,
    sourceTitle: null,
    sourceDescription: null,
    discoveredAt: null,
    employeeId: null,
    documentId: null,
    runId: null,
    scheduleEnabled: false,
    completedAt: null,
  };
}

export function normalizeWorkspaceState(state: WorkspaceState, companyId: string) {
  const onboarding = state.workspace.onboarding || createOnboardingState(state.employees.length ? "completed" : "not_started");
  return {
    ...state,
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
    employees: [],
    documents: [],
    conversations: [],
    runs: [],
    lists: [],
    sequences: [],
    tickets: [],
    activity: [],
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
        documentId: "doc-icp",
        runId: "run-atlas-1",
        scheduleEnabled: true,
        completedAt: timestamp,
      },
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
            lastAction: "Enriched via local demo provider",
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
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  return [...documents]
    .map((document) => {
      const haystack = `${document.name} ${document.content}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { document, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(({ score }) => score > 0)
    .slice(0, 3)
    .map(({ document }) => document);
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

export function buildFallbackReply(employee: Employee, message: string, documents: DocumentRecord[]) {
  const relevant = findRelevantDocuments(documents, message);
  const citations = relevant.length > 0 ? relevant.map((document) => document.name) : ["Employee system prompt"];
  const lower = message.toLowerCase();
  const context = relevant.length > 0 ? ` I grounded this in ${relevant.map((document) => `“${document.name}”`).join(" and ")}.` : " I did not find a matching workspace source, so treat this as a working hypothesis.";

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
  const prompt = [
    `You are ${goalDetails.name}, the ${goalDetails.title} for ${args.companyName}.`,
    `Your job is to improve ${args.goal} outcomes using only the workspace context.`,
    "Separate facts from assumptions, cite the source by name, and finish every response with one owner and one next action.",
  ].join(" ");
  const employee: Employee = {
    id: createId("emp"),
    name: goalDetails.name,
    title: goalDetails.title,
    department: goalDetails.department,
    avatar: goalDetails.name.slice(0, 2).toUpperCase(),
    systemPrompt: prompt,
    model: process.env.OLLAMA_MODEL ? `Ollama · ${process.env.OLLAMA_MODEL}` : "Ollama · not configured",
    status: "live",
    memoryScope: "company",
    score: 0,
    scoreTrend: [0],
    lastRunAt: null,
    schedule: null,
    promptVersions: [{ id: createId("pv"), version: 1, prompt, author: "Perpendicular onboarding", createdAt, note: "Created from live workspace discovery.", active: true }],
    goldenTests: [{ id: createId("gt"), input: goalDetails.task, expected: goalDetails.expected, lastScore: 0 }],
  };
  document.employeeIds = [employee.id];
  return { employee, document, task: goalDetails.task, sourceDescription };
}
