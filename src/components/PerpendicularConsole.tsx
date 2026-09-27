"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  Building2,
  BriefcaseBusiness,
  Bot,
  BrainCircuit,
  CalendarClock,
  Check,
  ClipboardCheck,
  ChevronRight,
  Database,
  FileText,
  Gauge,
  Globe2,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Lock,
  Mail,
  Megaphone,
  MessageSquare,
  Plus,
  PenLine,
  Plug,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  Unlock,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { Activity as ActivityRecord, ContentItem, DocumentRecord, Employee, Mission, OnboardingGoal, OutboundSafetySettings, Playbook, SmartList, SmartListAction, SmartRow, UsageSummary, WorkspaceState } from "@/lib/domain";
import type { DeadLetterJob } from "@/lib/job-store";
import type { WebhookEventSummary } from "@/lib/integration-store";
import { sequenceRequiresGmail } from "@/lib/sequence";
import { creditForecast } from "@/lib/usage-forecast";
import type { DeliverabilityCheck } from "@/lib/deliverability";
import { PlatformView, type PlatformViewName } from "@/components/PlatformViews";

type View = "overview" | "missions" | "employees" | "knowledge" | "content" | "lists" | "sequences" | "inbox" | "playbooks" | "activity" | "settings" | PlatformViewName;
type Mutation = (action: string, payload?: Record<string, unknown>, success?: string) => Promise<WorkspaceState | null>;
type Viewer = { email: string; firstName: string; lastName: string };
type OpsSummary = { webhooks: WebhookEventSummary[]; deadLetterJobs: DeadLetterJob[] };
type ApiKeySummary = { id: string; name: string; keyPrefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null };
type RuntimeHealth = {
  ok: boolean;
  database: string;
  model: string;
  version: string;
  configuration: { gaps: string[]; warnings: string[] };
  operations: { deadLetterJobs: number; failedWebhooks: number; degradedIntegrations: number } | null;
};
type SequenceDraftStep = {
  channel: "Email" | "LinkedIn" | "Task";
  title: string;
  delay: string;
  subject: string;
  body: string;
};

const emptySequenceDraftStep = (index = 0): SequenceDraftStep => ({
  channel: "Email",
  title: index === 0 ? "First touch" : `Follow-up ${index}`,
  delay: index === 0 ? "Day 0" : "After 3 days",
  subject: "",
  body: "",
});

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.NODE_ENV === "production" ? "https://perpendicular-api.bluebloodstudio.com" : "")).replace(/\/$/, "");
const canonicalOrigin = (process.env.NEXT_PUBLIC_CANONICAL_URL || (process.env.NODE_ENV === "production" ? "https://perpendicular.bluebloodstudio.com" : "")).replace(/\/$/, "");
const apiPath = (path: string) => `${apiBase}${path}`;

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || fallback;
}

const navGroups: { label: string; items: { id: View; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Workbench", icon: LayoutDashboard },
      { id: "company", label: "Company", icon: Building2 },
      { id: "chat", label: "Chat", icon: MessageSquare },
      { id: "scheduled", label: "Scheduled", icon: CalendarClock },
      { id: "dashboard", label: "Dashboard", icon: Gauge },
      { id: "missions", label: "Missions", icon: ClipboardCheck },
      { id: "employees", label: "Employees", icon: Bot },
      { id: "knowledge", label: "Knowledge", icon: BrainCircuit },
      { id: "people", label: "People", icon: Users },
      { id: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
      { id: "lead-data", label: "Lead Data", icon: Search },
    ],
  },
  {
    label: "Engage",
    items: [
      { id: "content", label: "Content", icon: PenLine },
      { id: "lists", label: "Smart Lists", icon: ListChecks },
      { id: "sequences", label: "Sequences", icon: Send },
      { id: "inbox", label: "Inbox", icon: Inbox },
      { id: "campaigns", label: "Campaigns", icon: Megaphone },
      { id: "keywords", label: "Keywords", icon: Radio },
    ],
  },
  {
    label: "Inbound",
    items: [
      { id: "inbound", label: "Agents & Sites", icon: Globe2 },
    ],
  },
  {
    label: "System",
    items: [
      { id: "activity", label: "Activity", icon: Activity },
      { id: "playbooks", label: "Playbooks", icon: Plug },
      { id: "apps", label: "Apps", icon: Plug },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const viewNames: Record<View, string> = {
  overview: "Workbench",
  company: "Company",
  chat: "Chat",
  scheduled: "Scheduled",
  dashboard: "Dashboard",
  missions: "Missions",
  employees: "Employees",
  knowledge: "Knowledge",
  people: "People",
  pipeline: "Pipeline",
  "lead-data": "Lead Data",
  content: "Content",
  lists: "Smart Lists",
  sequences: "Sequences",
  inbox: "Inbox",
  campaigns: "Campaigns",
  keywords: "Keywords",
  inbound: "Agents & Sites",
  playbooks: "Playbooks",
  apps: "Apps",
  activity: "Activity",
  settings: "Settings",
};

const platformViewNames = new Set<PlatformViewName>(["company", "chat", "scheduled", "dashboard", "people", "pipeline", "lead-data", "campaigns", "keywords", "inbound", "apps"]);

function navCount(view: View, state: WorkspaceState) {
  if (view === "employees") return state.employees.length;
  if (view === "people") return state.people.length || null;
  if (view === "pipeline") return state.deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length || null;
  if (view === "scheduled") return state.schedules.filter((schedule) => schedule.active).length || null;
  if (view === "campaigns") return state.campaigns.filter((campaign) => campaign.status !== "completed").length || null;
  if (view === "keywords") return state.keywordMonitors.filter((monitor) => monitor.status === "active").length || null;
  if (view === "inbound") return state.inboundAgents.filter((agent) => agent.status === "live").length || null;
  if (view === "missions") return state.missions.filter((mission) => mission.status !== "completed").length;
  if (view === "knowledge") return state.documents.length;
  if (view === "content") return state.content.filter((item) => item.status === "review").length || null;
  if (view === "lists") return state.lists.length;
  if (view === "sequences") return state.sequences.length;
  if (view === "inbox") return state.tickets.filter((ticket) => ticket.status !== "resolved").length;
  return null;
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const difference = Date.now() - new Date(value).getTime();
  const future = difference < 0;
  const minutes = Math.max(0, Math.floor(Math.abs(difference) / 60000));
  if (minutes < 1) return future ? "in a moment" : "Just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  return future ? `in ${Math.floor(hours / 24)}d` : `${Math.floor(hours / 24)}d ago`;
}

function forecastDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString([], { day: "numeric", month: "short" }) : "—";
}

function actionLabel(value: string | null) {
  return value ? value.replaceAll("-", " ") : "";
}

function isPast(value: string) {
  return new Date(value).getTime() < Date.now();
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function Sparkline({ values, large = false }: { values: number[]; large?: boolean }) {
  const safeValues = values.length > 1 ? values : [0, ...values];
  const max = Math.max(...safeValues, 1);
  const min = Math.min(...safeValues, 0);
  const span = Math.max(max - min, 1);
  const points = safeValues.map((value, index) => `${(index / (safeValues.length - 1)) * 100},${32 - ((value - min) / span) * 26}`).join(" ");
  return (
    <svg className={large ? "sparkline sparkline-large" : "sparkline"} viewBox="0 0 100 36" role="img" aria-label="Score trend">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusPill({ status }: { status: "live" | "paused" | "open" | "pending" | "resolved" | "new" | "enriched" | "draft" }) {
  return <span className={`status-pill ${status === "live" || status === "resolved" || status === "enriched" ? "live" : status === "paused" || status === "open" ? "paused" : ""}`}><span className="status-dot" />{status}</span>;
}

function ActivityGlyph({ type }: { type: ActivityRecord["type"] }) {
  const Icon = type === "run" ? Zap : type === "lead" ? Users : type === "ticket" ? Inbox : type === "employee" ? Bot : Database;
  return <Icon size={14} strokeWidth={1.7} />;
}

function MetricCard({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: "good" | "warn" | "" }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className={`metric-note ${tone}`}>{note}</div></div>;
}

function PageHeading({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children ? <div className="heading-actions">{children}</div> : null}</div>;
}

function PanelHeader({ title, caption, children }: { title: string; caption?: string; children?: React.ReactNode }) {
  return <div className="panel-header"><div><div className="panel-title">{title}</div>{caption ? <div className="panel-caption">{caption}</div> : null}</div>{children ? <div className="panel-header-actions">{children}</div> : null}</div>;
}

function RuntimeStatus({ health, error, compact = false }: { health: RuntimeHealth | null; error: boolean; compact?: boolean }) {
  const operationalIssue = Boolean(health?.configuration.gaps.length || health?.configuration.warnings.length || health?.operations?.deadLetterJobs || health?.operations?.failedWebhooks || health?.operations?.degradedIntegrations);
  const status = error ? "error" : !health ? "checking" : !health.ok ? "error" : operationalIssue ? "warning" : "healthy";
  const label = status === "error" ? (compact ? "Self-hosted · offline" : "Dell unavailable") : status === "checking" ? (compact ? "Self-hosted · checking" : "Checking Dell") : status === "warning" ? (compact ? "Self-hosted · attention" : "Dell online · attention") : compact ? "Self-hosted · online" : "Dell node healthy";
  const detail = error ? "The live Dell health endpoint could not be reached." : !health ? "Checking the live Dell health endpoint." : `API ${health.version.slice(0, 12)} · database ${health.database} · model ${health.model}${operationalIssue ? " · review configuration or operations" : ""}`;
  return <div className={`${compact ? "server-status" : "server-chip"} runtime-status ${status}`} title={detail} aria-live="polite"><span className="status-dot" />{label}</div>;
}

function EmployeeCard({ employee, selected, onSelect }: { employee: Employee; selected: boolean; onSelect: () => void }) {
  return <button className="employee-card" onClick={onSelect} aria-pressed={selected} style={selected ? { borderColor: "#805c3e" } : undefined}>
    <div className="employee-top"><div className="employee-identity"><div className="employee-avatar">{employee.avatar}</div><div><div className="employee-name">{employee.name}</div><div className="employee-title">{employee.title}</div></div></div><StatusPill status={employee.status} /></div>
    <div className="employee-bottom"><div><div className="score-label">Last score</div><div className="score-number">{employee.score || "—"}</div></div><Sparkline values={employee.scoreTrend} /></div>
  </button>;
}

function ChatPanel({ state, employeeId, setEmployeeId, input, setInput, onSend, busy }: { state: WorkspaceState; employeeId: string; setEmployeeId: (id: string) => void; input: string; setInput: (input: string) => void; onSend: () => void; busy: boolean }) {
  const employee = state.employees.find((item) => item.id === employeeId) || state.employees[0];
  const conversation = state.conversations.find((item) => item.employeeId === employee?.id);
  if (!employee) return <section className="panel chat-panel"><div className="panel-header"><div className="chat-meta"><div className="employee-avatar">AI</div><div><div className="panel-title">Employee chat</div><div className="panel-caption">Create an employee before sending work.</div></div></div><MessageSquare size={16} color="var(--text-dim)" /></div><div className="chat-empty"><div><Bot size={18} /><br />Your first employee becomes the context-aware operator for this workspace.</div></div></section>;
  return <section className="panel chat-panel"><div className="panel-header"><div className="chat-meta"><div className="employee-avatar">{employee?.avatar || "AI"}</div><div className="chat-employee"><select value={employee?.id} onChange={(event) => setEmployeeId(event.target.value)} aria-label="Choose an employee">{state.employees.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.title}</option>)}</select><div className="panel-caption">Knowledge-grounded · {employee?.model}</div></div></div><MessageSquare size={16} color="var(--text-dim)" /></div>
    <div className="chat-messages">{conversation?.messages.length ? conversation.messages.map((message) => <div className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === "assistant" ? employee?.name : "You"}</div><div className="message-body">{message.content}</div>{message.citations?.length ? <div className="citations">{message.citations.map((citation) => <span className="citation" key={citation}>{citation}</span>)}</div> : null}</div>) : <div className="chat-empty"><div><Sparkles size={18} /><br />Ask an employee to turn a messy question into a next action.</div></div>}</div>
    <div className="chat-compose"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder={`Ask ${employee?.name || "an employee"}…`} aria-label="Message an employee" /><button className="button-primary" onClick={onSend} disabled={busy || !input.trim()}>{busy ? "…" : "Send"}<ArrowUpRight size={13} /></button></div>
  </section>;
}

function RunRow({ run, employee }: { run: WorkspaceState["runs"][number]; employee?: Employee }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`run-row ${expanded ? "expanded" : ""}`}>
    <div className="run-avatar">{employee?.avatar || "AI"}</div>
    <div>
      <div className="run-title">{employee?.name || "Employee"} · {run.task}</div>
      <div className="run-detail">{run.reason}</div>
      <div className="run-trigger"><Radio size={11} />{run.trigger} · {relativeTime(run.createdAt)} · {run.durationMs}ms</div>
    </div>
    <div className="run-actions"><div className="run-score">{run.score}</div><button className="small-button" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "Hide trace" : "Inspect"}<ChevronRight size={11} className={expanded ? "rotate-90" : ""} /></button></div>
    {expanded ? <div className="run-inspector">
      <div className="run-output"><div className="run-inspector-label">Output</div><p>{run.output || "This run did not return an output."}</p></div>
      <div className="run-trace"><div className="run-inspector-label">Execution trace</div>{run.trace.length ? run.trace.map((step, index) => <div className="run-trace-step" key={`${run.id}-${step.label}`}><div className="trace-step-index">{index + 1}</div><div className="run-trace-copy"><strong>{step.label}</strong><span>{step.detail}</span></div><div className="run-trace-metrics">{step.durationMs}ms · {step.cost} credit</div></div>) : <div className="list-meta">No trace steps were recorded for this run.</div>}</div>
    </div> : null}
  </article>;
}

function EmployeeDetail({ employee, documents, mutate }: { employee: Employee; documents: DocumentRecord[]; mutate: Mutation }) {
  const [task, setTask] = useState(employee.schedule?.task || "Review this week's pipeline and write the highest-leverage next action.");
  const [config, setConfig] = useState<{
    model: string;
    temperature: string;
    reasoning: Employee["reasoning"];
    memoryScope: Employee["memoryScope"];
    tools: string[];
    knowledgeDocumentIds: string[];
  }>({
    model: employee.model.split(" · ")[0] || "qwen2.5:3b",
    temperature: String(employee.temperature ?? 0.35),
    reasoning: employee.reasoning || "balanced",
    memoryScope: employee.memoryScope,
    tools: employee.tools || [],
    knowledgeDocumentIds: employee.knowledgeDocumentIds || [],
  });
  const [newMemory, setNewMemory] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const currentVersion = employee.promptVersions.find((version) => version.active);
  const [selectedVersionId, setSelectedVersionId] = useState(currentVersion?.id || employee.promptVersions[0]?.id || "");
  const selectedVersion = employee.promptVersions.find((version) => version.id === selectedVersionId) || currentVersion;
  const scoreDelta = selectedVersion?.goldenScore != null && currentVersion?.goldenScore != null
    ? selectedVersion.goldenScore - currentVersion.goldenScore
    : null;
  const toolOptions = ["web_search", "http", "browser", "gmail", "calendar", "mcp"];
  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await mutate("update-employee-config", {
        employeeId: employee.id,
        model: config.model,
        temperature: Number(config.temperature),
        reasoning: config.reasoning,
        memoryScope: config.memoryScope,
        tools: config.tools,
        knowledgeDocumentIds: config.knowledgeDocumentIds,
      }, `${employee.name} configuration was saved.`);
    } finally {
      setSavingConfig(false);
    }
  };
  const addMemory = async (event: React.FormEvent) => {
    event.preventDefault();
    const memory = newMemory.trim();
    if (!memory) return;
    const saved = await mutate("add-employee-memory", { employeeId: employee.id, memory }, `${employee.name} memory was saved.`);
    if (saved) setNewMemory("");
  };
  return <div className="employee-detail"><section className="panel profile-strip"><div className="profile-main"><div className="employee-avatar">{employee.avatar}</div><div><div className="profile-name">{employee.name}</div><div className="profile-title">{employee.title} · {employee.department} · {employee.memoryScope}-scoped memory{employee.locked ? " · locked" : ""}</div></div></div><div className="profile-score"><div><div className="score-label">Quality score</div><div className="profile-score-number">{employee.score || "—"}</div></div><Sparkline values={employee.scoreTrend} large /></div></section>
    <section className="detail-card"><div className="detail-card-header"><h3>Runtime contract</h3><span>{employee.locked ? "Admin locked" : "Editable"}</span></div><div className="detail-card-body"><div className="form-grid"><div className="field"><label htmlFor="employee-model">Local model</label><input id="employee-model" value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} placeholder="qwen2.5:3b" disabled={employee.locked} /><div className="list-meta">The Dell Ollama worker uses this exact model tag.</div></div><div className="field"><label htmlFor="employee-temperature">Temperature · {config.temperature}</label><input id="employee-temperature" type="range" min="0" max="1" step="0.05" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: event.target.value })} disabled={employee.locked} /></div></div><div className="form-grid"><div className="field"><label htmlFor="employee-reasoning">Reasoning mode</label><select id="employee-reasoning" value={config.reasoning} onChange={(event) => setConfig({ ...config, reasoning: event.target.value as Employee["reasoning"] })} disabled={employee.locked}><option value="focused">Focused</option><option value="balanced">Balanced</option><option value="deep">Deep</option></select></div><div className="field"><label htmlFor="employee-memory-scope">Memory scope</label><select id="employee-memory-scope" value={config.memoryScope} onChange={(event) => setConfig({ ...config, memoryScope: event.target.value as Employee["memoryScope"] })} disabled={employee.locked}><option value="company">Company</option><option value="employee">Employee only</option></select></div></div><div className="field"><label>Tool permissions</label><div className="form-actions">{toolOptions.map((tool) => <label className="checkbox-row" key={tool}><input type="checkbox" checked={config.tools.includes(tool)} onChange={(event) => setConfig({ ...config, tools: event.target.checked ? [...config.tools, tool] : config.tools.filter((candidate) => candidate !== tool) })} disabled={employee.locked} />{tool.replace("_", " ")}</label>)}</div><div className="list-meta">These permissions are persisted with the employee and are visible to the worker contract.</div></div><div className="field"><label>Attached knowledge</label><div className="list-stack">{documents.length ? documents.map((document) => <label className="checkbox-row" key={document.id}><input type="checkbox" checked={config.knowledgeDocumentIds.includes(document.id)} onChange={(event) => setConfig({ ...config, knowledgeDocumentIds: event.target.checked ? [...config.knowledgeDocumentIds, document.id] : config.knowledgeDocumentIds.filter((id) => id !== document.id) })} disabled={employee.locked} /><span>{document.name}<small>{document.chunks} chunks · {document.source}</small></span></label>) : <div className="list-meta">Add a knowledge source before narrowing this employee.</div>}</div></div><div className="form-actions"><button className="button-primary" onClick={() => void saveConfig()} disabled={savingConfig || employee.locked}>{savingConfig ? "Saving…" : "Save runtime contract"}</button><button className="button-secondary" onClick={() => void mutate("toggle-employee-lock", { employeeId: employee.id, locked: !employee.locked }, `${employee.name} configuration was ${employee.locked ? "unlocked" : "locked"}.`)}>{employee.locked ? <Unlock size={13} /> : <Lock size={13} />}{employee.locked ? "Unlock" : "Lock configuration"}</button></div></div></section>
    <section className="detail-card"><div className="detail-card-header"><h3>Durable memory</h3><span>{(employee.memory || []).length} facts</span></div><div className="detail-card-body"><form className="form-actions" onSubmit={(event) => void addMemory(event)}><input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="e.g. Always lead with the customer impact." maxLength={500} aria-label="New employee memory" /><button className="button-secondary" type="submit"><Plus size={13} />Save memory</button></form><div className="list-stack">{(employee.memory || []).map((memory) => <div className="list-item" key={memory}><div className="list-desc">{memory}</div><button className="small-button" onClick={() => void mutate("remove-employee-memory", { employeeId: employee.id, memory }, `${employee.name} memory was removed.`)}>Remove</button></div>)}{!(employee.memory || []).length ? <div className="list-meta">No saved facts yet. Memory is explicit and removable.</div> : null}</div></div></section>
    <div className="detail-grid"><div className="detail-card"><div className="detail-card-header"><h3>Identity contract</h3><span>Prompt v{currentVersion?.version || 1}</span></div><div className="detail-card-body"><div className="prompt-box">{employee.systemPrompt}</div><div className="prompt-note"><ShieldCheck size={14} /> Changes are versioned. Nothing silently overwrites the live prompt.</div><div className="form-actions"><button className="button-secondary" onClick={() => void mutate("evaluate-employee", { employeeId: employee.id }, `${employee.name} evaluated against the golden set.`)}><Gauge size={13} />Run golden eval</button></div></div></div>
      <div className="detail-card"><div className="detail-card-header"><h3>Heartbeat</h3><span>{employee.schedule?.enabled ? "Autonomous" : "Manual only"}</span></div><div className="detail-card-body"><div className="field"><label htmlFor="heartbeat-task">Task to repeat</label><textarea id="heartbeat-task" value={task} onChange={(event) => setTask(event.target.value)} /></div><div className="field"><label htmlFor="heartbeat-cadence">Cadence</label><select id="heartbeat-cadence" defaultValue={employee.schedule?.cadence || "daily"}><option>every 15m</option><option>hourly</option><option>daily</option><option>weekly</option></select></div><button className="button-primary" onClick={() => void mutate("schedule-employee", { employeeId: employee.id, enabled: true, cadence: (document.getElementById("heartbeat-cadence") as HTMLSelectElement)?.value, task }, `${employee.name} will wake up on schedule.`)}><CalendarClock size={13} />Save schedule</button>{employee.schedule?.nextRunAt ? <div className="list-meta">Next wake-up {relativeTime(employee.schedule.nextRunAt)}</div> : null}</div></div>
    </div>
    <div className="detail-grid"><div className="detail-card"><div className="detail-card-header"><h3>Prompt versions</h3><span>{employee.promptVersions.length} recorded</span></div><div className="detail-card-body"><div className="version-list">{employee.promptVersions.slice(0, 4).map((version) => <div className={`version-row ${selectedVersionId === version.id ? "selected" : ""}`} key={version.id} role="button" tabIndex={0} onClick={() => setSelectedVersionId(version.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedVersionId(version.id); }}><div className="version-number">v{version.version}</div><div><div className="version-note">{version.note}</div><div className="version-author">{version.author} · {relativeTime(version.createdAt)}{version.goldenScore != null ? ` · eval ${version.goldenScore}` : ""}</div></div>{version.active ? <div className="active-tag">Live</div> : <div className="list-meta">Review</div>}</div>)}</div></div></div>
      <div className="detail-card"><div className="detail-card-header"><h3>Golden set</h3><span>{employee.goldenTests.length} cases · drift protected</span></div><div className="detail-card-body"><div className="golden-list">{employee.goldenTests.map((test) => <div className="golden-row" key={test.id}><div><div className="golden-input">{test.input}</div><div className="golden-expected">Expecting: {test.expected}</div></div><div className="golden-score">{test.lastScore || "—"}</div></div>)}</div></div></div>
    </div>
    {selectedVersion ? <section className="detail-card"><div className="detail-card-header"><h3>Prompt diff</h3><span>{selectedVersion.active ? "Live prompt" : `v${selectedVersion.version} against live`}</span></div><div className="detail-card-body"><div className="prompt-compare"><div><div className="prompt-compare-label">Selected · v{selectedVersion.version}</div><pre>{selectedVersion.prompt}</pre></div><div><div className="prompt-compare-label">Live · v{currentVersion?.version || 1}</div><pre>{currentVersion?.prompt || employee.systemPrompt}</pre></div></div><div className="prompt-note"><Gauge size={14} />{selectedVersion.goldenScore != null ? `Golden score ${selectedVersion.goldenScore}${scoreDelta == null ? "" : ` · ${scoreDelta >= 0 ? "+" : ""}${scoreDelta} vs live`}` : "This version has not been evaluated yet."}</div><div className="form-actions">{!selectedVersion.active ? <><button className="button-secondary" onClick={() => void mutate("evaluate-employee", { employeeId: employee.id, promptVersionId: selectedVersion.id }, `Prompt v${selectedVersion.version} evaluated.`)}><Gauge size={13} />Evaluate this version</button><button className="button-primary" onClick={() => void mutate("activate-prompt-version", { employeeId: employee.id, promptVersionId: selectedVersion.id }, `Prompt v${selectedVersion.version} is live.`)}><Check size={13} />Make live</button></> : <span className="active-tag">Current prompt</span>}</div></div></section> : null}
    <div className="detail-card"><PanelHeader title="Run a real task" caption="The same worker path used by a heartbeat." /><div className="form-card"><div className="field"><label htmlFor="real-task">Task</label><textarea id="real-task" value={task} onChange={(event) => setTask(event.target.value)} /></div><button className="button-primary" onClick={() => void mutate("run-employee", { employeeId: employee.id, task }, `${employee.name} completed the task and received a score.`)}><Zap size={13} />Run now</button></div></div>
  </div>;
}

function Overview({ state, usage, selectedEmployeeId, setSelectedEmployeeId, setView, chatInput, setChatInput, chatBusy, onSend }: { state: WorkspaceState; usage: UsageSummary | null; selectedEmployeeId: string; setSelectedEmployeeId: (id: string) => void; setView: (view: View) => void; chatInput: string; setChatInput: (value: string) => void; chatBusy: boolean; onSend: () => void }) {
  const latestRuns = state.runs.slice(0, 4);
  const openTickets = state.tickets.filter((ticket) => ticket.status !== "resolved").length;
  const breachedTickets = state.tickets.filter((ticket) => ticket.status !== "resolved" && isPast(ticket.slaDueAt)).length;
  const reviewMission = state.missions.find((mission) => mission.status === "needs_review");
  const readyMission = state.missions.find((mission) => mission.status === "ready" && mission.employeeId);
  const idea = state.content.find((item) => item.status === "idea");
  const nextMove = reviewMission
    ? { title: `Review ${reviewMission.title}`, detail: "A real operator result is waiting for your decision. Inspect the output before it becomes part of the operating record.", view: "missions" as View, label: "Review result" }
    : !state.lists.length
      ? { title: "Bring in your first working list", detail: "Import a CSV or add one lead, then research it with public evidence before any sequence can send.", view: "lists" as View, label: "Open Smart Lists" }
      : readyMission
        ? { title: `Run ${readyMission.title}`, detail: "The next owned mission is ready. Run it through the local worker and leave the result in the review queue.", view: "missions" as View, label: "Run next mission" }
        : idea
          ? { title: "Draft your first content item", detail: "Turn the indexed company context into a specific point of view, then approve it before scheduling.", view: "content" as View, label: "Open Content" }
          : { title: "Ask an employee for the next action", detail: "Use the grounded chat on this page for a decision, then promote the answer into a mission when it needs ownership.", view: "employees" as View, label: "Open Employees" };
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const dailyAiBurn = usage && usage.aiUnits > 0 ? usage.aiUnits / 30 : 0;
  const thresholdRemaining = state.workspace.aiCredits.limit * 0.1;
  const forecastDays = dailyAiBurn > 0 && state.workspace.aiCredits.remaining > thresholdRemaining
    ? Math.ceil((state.workspace.aiCredits.remaining - thresholdRemaining) / dailyAiBurn)
    : null;
  const forecastNote = usage ? (forecastDays ? `90% threshold in about ${forecastDays}d at current burn` : "At or below the 90% threshold") : "No 30-day burn recorded";
  return <><PageHeading eyebrow={dateLabel} title="Make the work visible." subtitle="Perpendicular keeps employees, context, and follow-through in one loop. Every autonomous action leaves behind a score, a trace, and a next move."><button className="button-secondary" onClick={() => setView("activity")}><Activity size={13} />View activity</button><button className="button-primary" onClick={() => setView("employees")}><Plus size={13} />Hire an employee</button></PageHeading>
    <div className="metric-grid"><MetricCard label="AI Credits" value={`${state.workspace.aiCredits.remaining}`} note={`${state.workspace.aiCredits.limit - state.workspace.aiCredits.remaining} used · ${forecastNote}`} tone={state.workspace.aiCredits.remaining < state.workspace.aiCredits.limit * 0.1 ? "warn" : ""} /><MetricCard label="Data Credits" value={`${state.workspace.dataCredits.remaining}`} note={`${state.workspace.dataCredits.purchased - state.workspace.dataCredits.remaining} used · public research only`} tone="good" /><MetricCard label="Missions" value={`${state.missions.filter((mission) => mission.status !== "completed").length}`} note={`${state.missions.filter((mission) => mission.status === "needs_review").length} awaiting your review`} tone={state.missions.some((mission) => mission.status === "needs_review") ? "warn" : "good"} /><MetricCard label="Needs attention" value={`${openTickets}`} note={breachedTickets ? `${breachedTickets} SLA breach${breachedTickets === 1 ? "" : "es"}` : "No SLA breaches"} tone={breachedTickets ? "warn" : "good"} /></div>
    <section className="next-move panel"><div><div className="eyebrow">Next move</div><h2>{nextMove.title}</h2><p>{nextMove.detail}</p></div><button className="button-primary" onClick={() => setView(nextMove.view)}>{nextMove.label}<ChevronRight size={13} /></button></section>
    <div className="workbench-grid"><div><section className="panel"><PanelHeader title="Autonomous work" caption="The latest work, not a notification feed."><button className="button-quiet" onClick={() => setView("activity")}>Open log <ChevronRight size={13} /></button></PanelHeader><div className="run-list">{latestRuns.map((run) => <RunRow key={run.id} run={run} employee={state.employees.find((item) => item.id === run.employeeId)} />)}</div>{!latestRuns.length ? <div className="empty-state">No runs yet. Open an employee, ask a question, or run a mission to create the first trace.</div> : null}</section><section className="panel"><PanelHeader title="What needs a decision" caption={`${state.missions.length} missions · outputs stay reviewable`}><button className="button-quiet" onClick={() => setView("missions")}>Open missions <ChevronRight size={13} /></button></PanelHeader><div className="list-stack">{state.missions.slice(0, 3).map((mission) => <div className="list-item" key={mission.id}><div className="list-main"><div className="list-title">{mission.title}</div><div className="list-meta">{state.employees.find((employee) => employee.id === mission.employeeId)?.name || "Unassigned"} · {mission.status.replaceAll("_", " ")}</div></div><WorkflowStatus status={mission.status} /></div>)}</div></section><div className="section-block"><div className="section-kicker"><h2>People doing the work</h2><span>{state.employees.length} employees · {state.employees.filter((employee) => employee.schedule?.enabled).length} autonomous</span></div><div className="employee-grid">{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selectedEmployeeId} onSelect={() => { setSelectedEmployeeId(employee.id); setView("employees"); }} key={employee.id} />)}</div></div></div><ChatPanel state={state} employeeId={selectedEmployeeId} setEmployeeId={setSelectedEmployeeId} input={chatInput} setInput={setChatInput} onSend={onSend} busy={chatBusy} /></div>
  </>;
}

function EmployeesView({ state, selectedEmployeeId, setSelectedEmployeeId, mutate, setShowHire }: { state: WorkspaceState; selectedEmployeeId: string; setSelectedEmployeeId: (id: string) => void; mutate: Mutation; setShowHire: (show: boolean) => void }) {
  const selected = state.employees.find((employee) => employee.id === selectedEmployeeId) || state.employees[0];
  return <><PageHeading eyebrow="The core primitive" title="Employees, not chats." subtitle="Named roles with memory, knowledge, tools, schedules, and a quality score that improves in public."><button className="button-primary" onClick={() => setShowHire(true)}><Plus size={13} />Hire employee</button></PageHeading><div className="employee-grid section-block" style={{ marginTop: 0 }}>{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selected?.id} onSelect={() => setSelectedEmployeeId(employee.id)} key={employee.id} />)}</div>{selected ? <div className="section-block"><EmployeeDetail key={selected.id} employee={selected} documents={state.documents} mutate={mutate} /></div> : <div className="empty-state">Hire the first employee to open the workbench.</div>}</>;
}

function KnowledgeView({ state, setShowDocument }: { state: WorkspaceState; setShowDocument: (show: boolean) => void }) {
  return <><PageHeading eyebrow="Ground truth" title="Knowledge that stays attached." subtitle="Give employees the context they need, scoped to the company. Every answer shows what it used—and when it had to fall back."><button className="button-primary" onClick={() => setShowDocument(true)}><Plus size={13} />Add knowledge</button></PageHeading><div className="subpage-grid"><section className="panel"><PanelHeader title="Workspace sources" caption={`${state.documents.length} sources · ${state.documents.reduce((total, document) => total + document.chunks, 0)} indexed chunks`} /> <div className="list-stack">{state.documents.map((document) => <div className="list-item" key={document.id}><div className="list-main"><div className="list-title"><span className="source-tag">{document.source}</span>{document.name}</div><div className="list-desc">{document.content}</div><div className="list-meta">{document.chunks} chunks · shared with {document.employeeIds.length} employee{document.employeeIds.length === 1 ? "" : "s"} · updated {relativeTime(document.updatedAt)}</div></div><StatusPill status={document.status === "ready" ? "enriched" : "pending"} /></div>)}</div></section><div className="list-stack"><section className="panel form-card"><h3>Retrieval contract</h3><p>Simple local retrieval is live in this build. Swap the adapter for Qdrant embeddings on the Dell without changing the employee contract.</p><div className="setting-row"><div><div className="setting-name">Scoped by company</div><div className="setting-description">No cross-tenant reads.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">Citations on answers</div><div className="setting-description">Source names travel with the message.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">No source match</div><div className="setting-description">Fallback is explicitly labeled.</div></div><Check size={15} color="var(--mint)" /></div></section><section className="panel form-card"><h3>What happens next</h3><p>Upload a PDF, paste a URL, or add a playbook. New sources are shared with live employees by default and can later be narrowed field-by-field.</p><button className="button-secondary" onClick={() => setShowDocument(true)}><FileText size={13} />Add a source</button></section></div></div></>;
}

function ListsView({ state, mutate, setShowList, setShowLead }: { state: WorkspaceState; mutate: Mutation; setShowList: (show: boolean) => void; setShowLead: (show: boolean, listId?: string) => void; setShowDocument?: (show: boolean) => void }) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const list = state.lists.find((candidate) => candidate.id === selectedListId) || state.lists[0];
  const [actionError, setActionError] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [csvErrors, setCsvErrors] = useState<Array<{ line: number; reason: string }>>([]);
  const [csvBusy, setCsvBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [actionForm, setActionForm] = useState<{ name: string; type: SmartListAction["type"]; condition: SmartListAction["condition"]; scoreThreshold: string; employeeId: string; sequenceId: string }>({ name: "", type: "enrich", condition: "new", scoreThreshold: "70", employeeId: state.employees[0]?.id || "", sequenceId: state.sequences[0]?.id || "" });
  const filteredRows = list?.rows.filter((row) => `${row.name} ${row.company} ${row.role}`.toLowerCase().includes(filter.toLowerCase())) || [];
  const batchMatches = list?.rows.filter((row) => actionForm.condition === "new"
    ? row.status === "new"
    : actionForm.condition === "score_at_least"
      ? row.score >= Number(actionForm.scoreThreshold || 0)
      : true) || [];
  const batchRows = batchMatches.slice(0, 50);
  const batchCreditLabel = actionForm.type === "enrich"
    ? `${batchRows.length * 2} Data Credits`
    : actionForm.type === "run_employee"
      ? `${batchRows.length * 2} AI Credits`
      : "No AI or Data Credits";
  const batchSequence = state.sequences.find((sequence) => sequence.id === actionForm.sequenceId);
  const batchGmailRequired = actionForm.type === "enroll" && batchSequence && sequenceRequiresGmail(batchSequence)
    && !state.integrations?.some((integration) => integration.provider === "gmail" && integration.status === "connected");
  const createListAction = (event: React.FormEvent) => {
    event.preventDefault();
    if (!list) return;
    void mutate("create-list-action", { listId: list.id, ...actionForm, scoreThreshold: Number(actionForm.scoreThreshold) }, `${actionForm.name} was added to ${list.name}.`).then((saved) => {
      if (saved) setActionForm({ ...actionForm, name: "" });
    });
  };
  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !list) return;
    setCsvBusy(true);
    setCsvMessage(null);
    setCsvErrors([]);
    try {
      const saved = await mutate("import-csv", { listId: list.id, csv: await file.text() }, "CSV processed. Review the import report below.");
      const summary = saved && (saved as WorkspaceState & { importSummary?: { imported: number; skipped: number; errors: Array<{ line: number; reason: string }> } }).importSummary;
      if (!summary) throw new Error("The import completed without a report. Refresh the list before continuing.");
      setCsvMessage(`${summary.imported} lead${summary.imported === 1 ? "" : "s"} imported · ${summary.skipped} skipped.`);
      setCsvErrors(summary.errors);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "CSV import failed.");
    } finally {
      setCsvBusy(false);
    }
  };
  return <><PageHeading eyebrow="Rows that do work" title="Smart Lists are workflows." subtitle="Import people, research public company evidence, and enroll only qualified rows. Perpendicular never labels an email verified without a real verification provider."><button className="button-secondary" onClick={() => setShowList(true)}><Plus size={13} />Create list</button>{state.lists.length > 1 ? <select className="button-secondary" value={list?.id || ""} onChange={(event) => { setSelectedListId(event.target.value); setFilter(""); setCsvMessage(null); setCsvErrors([]); }} aria-label="Choose smart list">{state.lists.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select> : null}{list ? <label className="button-secondary">{csvBusy ? "Importing…" : "Import CSV"}<input type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event)} disabled={csvBusy} hidden /></label> : null}<button className="button-primary" disabled={!list} onClick={() => list && setShowLead(true, list.id)}><Plus size={13} />Add lead</button></PageHeading>{actionError ? <div className="notice" role="alert">{actionError}</div> : null}{list ? <div className="panel"><PanelHeader title={list.name} caption={`${list.rows.length} rows · ${list.rows.filter((row) => row.status === "enriched").length} researched`}><div className="server-status"><span className="status-dot" />Public evidence only</div></PanelHeader><div className="form-card"><PanelHeader title="Batch actions" caption="Up to 50 matching rows per run · credits are checked before work starts" /><form onSubmit={createListAction}><div className="form-grid"><div className="field"><label htmlFor="list-action-name">Name</label><input id="list-action-name" required value={actionForm.name} onChange={(event) => setActionForm({ ...actionForm, name: event.target.value })} placeholder="Research new leads" /></div><div className="field"><label htmlFor="list-action-type">Action</label><select id="list-action-type" value={actionForm.type} onChange={(event) => setActionForm({ ...actionForm, type: event.target.value as SmartListAction["type"] })}><option value="enrich">Research public company</option><option value="run_employee">Run local employee</option><option value="suppress">Suppress rows</option><option value="enroll">Enroll in sequence</option></select></div></div><div className="form-grid"><div className="field"><label htmlFor="list-action-condition">Only rows matching</label><select id="list-action-condition" value={actionForm.condition} onChange={(event) => setActionForm({ ...actionForm, condition: event.target.value as SmartListAction["condition"] })}><option value="new">Not researched</option><option value="score_at_least">Score at least</option><option value="all">All rows</option></select></div>{actionForm.condition === "score_at_least" ? <div className="field"><label htmlFor="list-action-threshold">Score threshold</label><input id="list-action-threshold" type="number" min="0" max="100" value={actionForm.scoreThreshold} onChange={(event) => setActionForm({ ...actionForm, scoreThreshold: Number.parseInt(event.target.value || "0", 10).toString() })} /></div> : <div />}</div>{actionForm.type === "run_employee" ? <div className="field"><label htmlFor="list-action-employee">Employee</label><select id="list-action-employee" value={actionForm.employeeId} onChange={(event) => setActionForm({ ...actionForm, employeeId: event.target.value })}>{state.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.title}</option>)}</select></div> : null}{actionForm.type === "enroll" ? <div className="field"><label htmlFor="list-action-sequence">Sequence</label><select id="list-action-sequence" value={actionForm.sequenceId} onChange={(event) => setActionForm({ ...actionForm, sequenceId: event.target.value })}>{state.sequences.map((sequence) => <option value={sequence.id} key={sequence.id}>{sequence.name} · {sequence.status}</option>)}</select></div> : null}<div className="batch-estimate" role="status"><strong>{batchRows.length} matching row{batchRows.length === 1 ? "" : "s"}</strong>{batchMatches.length > 50 ? <span> · capped at 50 per run</span> : null}<span> · estimated {batchCreditLabel}</span>{batchGmailRequired ? <span> · connect Gmail before enrollment</span> : null}</div><button className="button-secondary" type="submit"><Plus size={13} />Save batch action</button></form>{(list.actions || []).length ? <div className="list-stack">{(list.actions || []).map((batchAction) => <div className="list-item" key={batchAction.id}><div><div className="list-title">{batchAction.name} <span className={`status-pill ${batchAction.active ? "live" : "paused"}`}>{batchAction.active ? "active" : "paused"}</span></div><div className="list-desc">{batchAction.type.replace("_", " ")} · {batchAction.condition === "score_at_least" ? `score ≥ ${batchAction.scoreThreshold}` : batchAction.condition} · {batchAction.lastSummary || "not run yet"}</div></div><div className="row-actions"><button className="small-button" disabled={!batchAction.active} onClick={() => void mutate("run-list-action", { listId: list.id, actionId: batchAction.id }, `${batchAction.name} completed.`)}><Zap size={11} />Run</button><button className="small-button" onClick={() => void mutate("toggle-list-action", { listId: list.id, actionId: batchAction.id, active: !batchAction.active }, `${batchAction.name} ${batchAction.active ? "paused" : "resumed"}.`)}>{batchAction.active ? "Pause" : "Resume"}</button></div></div>)}</div> : null}</div>{csvMessage ? <div className="notice" role="status">{csvMessage}</div> : null}{csvErrors.length ? <div className="health-log"><div className="list-meta">Import issues</div>{csvErrors.slice(0, 12).map((error) => <div className="list-meta" key={`${error.line}-${error.reason}`}>Row {error.line}: {error.reason}</div>)}</div> : null}<div className="list-toolbar"><div className="toolbar-search"><SearchIcon /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search rows…" aria-label="Search smart list rows" /></div><div className="credit-preview"><Database size={13} />Research estimate: <strong>{filteredRows.length * 2} Data Credits</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role / location</th><th>ICP score</th><th>Signal</th><th>Sequence</th><th>Actions</th></tr></thead><tbody>{filteredRows.map((row) => <SmartRowItem key={row.id} row={row} list={list} state={state} mutate={mutate} />)}</tbody></table>{!filteredRows.length ? <div className="empty-state">Add a lead to start this list.</div> : null}</div></div> : <div className="empty-state">Create a list, then add a lead or import one through the API.</div>}</>;
}

function SearchIcon() { return <span className="search-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>; }

function SmartRowItem({ row, list, state, mutate }: { row: SmartRow; list: SmartList; state: WorkspaceState; mutate: Mutation }) {
  const sequence = state.sequences[0];
  const gmailConnected = state.integrations?.some((integration) => integration.provider === "gmail" && integration.status === "connected") === true;
  const connectGmail = <a className="small-button" href={apiPath("/api/integrations/google/start")}><Mail size={11} />Connect Gmail</a>;
  const suppressed = state.suppressedEmails.includes(row.email.toLowerCase());
  const nextStepIndex = row.sequenceStepIndex || 0;
  const nextStep = sequence?.steps[nextStepIndex];
  const requiresGmail = sequence ? sequenceRequiresGmail(sequence) : false;
  const completed = Boolean(sequence && nextStepIndex >= sequence.steps.length);
  const hasSentStep = Boolean(row.lastProviderMessageId);
  const sequenceAction = suppressed
    ? <span className="small-button">Blocked</span>
    : !sequence
      ? <span className="small-button">No sequence</span>
      : completed
        ? <span className="small-button ready"><Check size={11} />Complete</span>
        : row.status !== "enriched"
          ? <span className="small-button">Research first</span>
        : row.enrollmentStatus !== "enrolled"
          ? requiresGmail && !gmailConnected ? connectGmail : <button className="small-button" onClick={() => void mutate("enroll-row", { listId: list.id, rowId: row.id, sequenceId: sequence.id }, `${row.name} enrolled with reply-pause enabled.`)}><Send size={11} />Enroll</button>
          : sequence.status !== "live"
              ? <span className="small-button">Activate sequence</span>
              : nextStep?.channel !== "Email"
                ? <button className="small-button" onClick={() => void mutate("create-sequence-task", { listId: list.id, rowId: row.id, sequenceId: sequence.id, stepIndex: nextStepIndex }, `${row.name} received a ${nextStep?.channel || "manual"} task in Missions.`)}><ClipboardCheck size={11} />Create task</button>
                : !gmailConnected
                  ? connectGmail
                  : <button className="small-button" onClick={() => void mutate("send-sequence-step", { listId: list.id, rowId: row.id, sequenceId: sequence.id, stepIndex: nextStepIndex }, `${row.name} received the approved sequence email.`)}><Send size={11} />{hasSentStep ? `Send step ${nextStepIndex + 1}` : "Send approved email"}</button>;
  const listStatus = suppressed ? "suppressed" : completed ? "complete" : hasSentStep ? `step ${nextStepIndex} sent` : row.enrollmentStatus;
  return <tr><td><div className="row-name"><div className="row-initial">{initials(row.name)}</div><div><strong>{row.name}</strong><div className="row-company">{row.company} · {row.email}</div></div></div></td><td><strong>{row.role}</strong><div className="row-company">{row.location}</div></td><td className="score-cell" title={(row.scoreReasons || []).join(" · ")}><strong>{row.score}</strong><div className="row-company">{row.scoreReasons?.[0] || "Awaiting score explanation"}</div></td><td><div>{row.intent}</div><div className={`row-company ${row.emailStatus === "verified" ? "verified" : "unknown"}`}>{row.emailStatus === "verified" ? "Verified email" : "Needs enrichment"}</div></td><td><span className={suppressed ? "unknown" : completed || hasSentStep ? "verified" : "unknown"}>{listStatus}</span></td><td><div className="row-actions">{suppressed ? <button className="small-button" onClick={() => void mutate("unsuppress-row", { listId: list.id, rowId: row.id }, `${row.name} can be enrolled again.`)}>Unsuppress</button> : <button className="small-button" onClick={() => void mutate("suppress-row", { listId: list.id, rowId: row.id }, `${row.name} suppressed for this workspace.`)}>Suppress</button>}{row.status === "enriched" ? <span className="small-button ready"><Check size={11} />Ready</span> : <button className="small-button" onClick={() => void mutate("enrich-row", { listId: list.id, rowId: row.id }, `${row.name} enriched. 2 Data Credits used.`)}><Zap size={11} />Enrich</button>}{sequenceAction}</div></td></tr>;
}

function SequencesView({ state, mutate, setShowSequence }: { state: WorkspaceState; mutate: Mutation; setShowSequence: (show: boolean) => void }) {
  const list = state.lists[0];
  const nextSequence = state.sequences[0];
  const gmailConnected = state.integrations?.some((integration) => integration.provider === "gmail" && integration.status === "connected") === true;
  const requiresGmail = nextSequence ? sequenceRequiresGmail(nextSequence) : false;
  const nextRow = list?.rows.find((row) => row.status === "enriched" && row.enrollmentStatus !== "enrolled");
  const enrollAction = !list || !nextSequence || !nextRow
    ? <button className="button-secondary" disabled><Send size={13} />No researched row ready</button>
    : nextSequence.status !== "live"
      ? <button className="button-secondary" disabled><Check size={13} />Activate sequence before enrolling</button>
    : !requiresGmail || gmailConnected
      ? <button className="button-secondary" onClick={() => void mutate("enroll-row", { listId: list.id, rowId: nextRow.id, sequenceId: nextSequence.id }, "The next researched row entered the sequence.")}><Send size={13} />Enroll next researched row</button>
      : <a className="button-secondary" href={apiPath("/api/integrations/google/start")}><Mail size={13} />Connect Gmail to enroll</a>;
  return <><PageHeading eyebrow="One list, one send" title="Follow-through with guardrails." subtitle="A sequence is a controlled rhythm—not a blast. Gmail, reply-pause, suppression, and human approval are part of the send path."><button className="button-primary" onClick={() => setShowSequence(true)}><Plus size={13} />Create sequence</button>{enrollAction}</PageHeading>{state.sequences.length ? <div className="sequence-list">{state.sequences.map((sequence) => <section className="sequence-card" key={sequence.id}><div className="sequence-head"><div><div className="sequence-name">{sequence.name} <StatusPill status={sequence.status === "live" ? "live" : "draft"} /></div><div className="sequence-audience">Audience · {sequence.audience}</div></div><div className="sequence-metrics"><div className="sequence-metric"><strong>{sequence.enrolled}</strong><span>Enrolled</span></div><div className="sequence-metric"><strong>{sequence.sent || 0}</strong><span>Sent</span></div><div className="sequence-metric"><strong>{sequence.replied}</strong><span>Replies</span></div><div className="sequence-metric"><strong>{sequence.booked}</strong><span>Booked</span></div></div></div><div className="steps">{sequence.steps.map((step, index) => <div className="step" key={step.id}><div className="step-number">{index + 1}</div><div className="step-channel">{step.channel}</div><div><div className="step-title">{step.title}</div>{step.subject ? <div className="step-body">Subject: {step.subject}</div> : null}<div className="step-body">{step.body}</div></div><div className="step-delay">{step.delay}</div></div>)}</div>{sequence.status === "live" ? <div className="sequence-footer"><span className="list-meta">Suppression · reply-pause · timezone windows · audit log</span></div> : <div className="sequence-footer"><span className="list-meta">Draft · review this message, then activate it for explicit sends.</span><button className="small-button ready" onClick={() => void mutate("activate-sequence", { sequenceId: sequence.id }, `${sequence.name} is live. Each email still needs your approval.`)}><Check size={11} />Activate after review</button></div>}</section>)}</div> : <div className="empty-state">Create a draft sequence, then connect Gmail before any external send is enabled.</div>}</>;
}

type InboxMessage = {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  direction: "inbound" | "outbound";
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
};

function WidgetInboxSection({ state }: { state: WorkspaceState }) {
  const conversations = state.widgetConversations || [];
  return <section className="panel"><PanelHeader title="Website conversations" caption={`${conversations.length} persisted visitor conversation${conversations.length === 1 ? "" : "s"}`}><span className="server-status"><MessageSquare size={13} color="var(--mint)" />Widget handoff</span></PanelHeader>{conversations.length ? <div className="list-stack">{conversations.slice(0, 12).map((conversation) => { const last = conversation.messages[conversation.messages.length - 1]; const employee = state.employees.find((candidate) => candidate.id === conversation.employeeId); return <article className="list-item" key={conversation.id}><div className="list-main"><div className="list-title">{employee?.name || "Operator"} · website visitor</div><div className="list-desc">{last?.content || "Conversation started."}</div><div className="list-meta">{conversation.messages.length} messages · {relativeTime(conversation.updatedAt)} · session {conversation.sessionId.slice(0, 18)}</div></div><span className="status-pill live"><span className="status-dot" />grounded</span></article>; })}</div> : <div className="empty-state">Website conversations appear here after the public widget receives its first message.</div>}</section>;
}

function InboxView({ state, mutate, setShowTicket }: { state: WorkspaceState; mutate: Mutation; setShowTicket: (show: boolean) => void }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [inboxError, setInboxError] = useState<string | null>(null);
  useEffect(() => {
    fetch(apiPath("/api/inbox"), { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { messages?: InboxMessage[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Inbox is unavailable.");
        setMessages(body.messages || []);
      })
      .catch((error) => setInboxError(error instanceof Error ? error.message : "Inbox is unavailable."));
  }, []);
  return <><PageHeading eyebrow="Support that is a system" title="Tickets and conversations, not vague handoffs." subtitle="Every escalation has an ID, an owner, an SLA clock, and a customer rating. Draft a grounded reply, then send it through Gmail only when a human approves it."><button className="button-primary" onClick={() => setShowTicket(true)}><Plus size={13} />Open ticket</button></PageHeading><WidgetInboxSection state={state} /><section className="panel"><PanelHeader title="Gmail inbox" caption={`${messages.length} persisted message${messages.length === 1 ? "" : "s"} · sync from Settings`}><span className="server-status"><Mail size={13} color="var(--mint)" />Workspace-scoped</span></PanelHeader>{inboxError ? <div className="empty-state">{inboxError}</div> : messages.length ? <div className="mail-list">{messages.map((message) => <article className="mail-row" key={message.id}><div className="mail-direction"><Mail size={14} /><span>{message.direction}</span></div><div className="mail-main"><div className="mail-subject">{message.subject || "(no subject)"}</div><div className="mail-meta">{message.sender} · {relativeTime(message.receivedAt)} · thread {message.providerThreadId}</div><p>{message.bodyText}</p></div></article>)}</div> : <div className="empty-state">No Gmail messages have been synced yet. Connect Gmail and run Sync inbox from Settings.</div>}</section><section className="panel"><PanelHeader title="Support queue" caption={`${state.tickets.filter((ticket) => ticket.status !== "resolved").length} active · SLA timers running`}><span className="server-status"><Timer size={13} color="var(--signal)" />SLA-aware</span></PanelHeader><div className="ticket-list">{state.tickets.map((ticket) => <div className="ticket" key={ticket.id}><div><div className="ticket-id">{ticket.id}</div><span className={`ticket-priority ${ticket.priority}`}>{ticket.priority}</span></div><div><div className="ticket-subject">{ticket.subject}</div><div className="ticket-message">{ticket.message}</div>{ticket.replyDraft ? <div className="prompt-box mission-output"><strong>Reply draft</strong><br />{ticket.replyDraft}<div className="list-meta">{ticket.replyCitations?.length ? `Sources: ${ticket.replyCitations.join(" · ")}` : "No source citation returned"} · {ticket.replyProviderMessageId ? "sent through Gmail" : "draft only"}</div></div> : null}<div className="ticket-sla">{ticket.status === "resolved" ? "Resolved" : isPast(ticket.slaDueAt) ? "SLA breached · needs escalation" : `SLA due ${relativeTime(ticket.slaDueAt).replace("ago", "from now")}`} · owner {ticket.assignee}{ticket.requesterEmail ? ` · ${ticket.requesterEmail}` : ""}</div></div><div className="row-actions">{ticket.status !== "resolved" ? <><button className="small-button" onClick={() => void mutate("draft-ticket-reply", { ticketId: ticket.id }, `${ticket.id} received a grounded reply draft.`)}><MessageSquare size={11} />{ticket.replyDraft ? "Redraft" : "Draft reply"}</button>{ticket.replyDraft && ticket.requesterEmail && !ticket.replyProviderMessageId ? <button className="small-button ready" onClick={() => void mutate("send-ticket-reply", { ticketId: ticket.id }, `${ticket.id} was sent through Gmail.`)}><Send size={11} />Send reply</button> : null}<button className="small-button" onClick={() => void mutate("resolve-ticket", { ticketId: ticket.id }, `${ticket.id} resolved with the trace attached.`)}><Check size={11} />Resolve</button></> : ticket.csat ? <span className="small-button ready">CSAT {ticket.csat}/5</span> : <button className="small-button" onClick={() => void mutate("rate-ticket", { ticketId: ticket.id, rating: 5 }, `${ticket.id} received a 5/5 CSAT.`)}>Rate 5/5</button>}</div></div>)}</div></section></>;
}

function ActivityView({ state }: { state: WorkspaceState }) {
  return <><PageHeading eyebrow="Proof of work" title="Everything leaves a trace." subtitle="Autonomy only earns trust when you can inspect what happened, why it happened, and what it cost."><span className="server-status"><ShieldCheck size={13} color="var(--mint)" />Company-scoped audit log</span></PageHeading><section className="panel"><PanelHeader title="Activity log" caption={`${state.activity.length} recent events · newest first`} /><div className="activity-list">{state.activity.map((item) => <div className="activity-row" key={item.id}><div className="activity-icon"><ActivityGlyph type={item.type} /></div><div><div className="activity-title">{item.title}</div><div className="activity-detail">{item.detail}</div></div><div className="activity-time">{relativeTime(item.createdAt)}</div></div>)}</div></section></>;
}

function WorkflowStatus({ status }: { status: Mission["status"] | ContentItem["status"] }) {
  const tone = status === "completed" || status === "approved" || status === "published" ? "live" : status === "blocked" ? "paused" : "";
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{status.replaceAll("_", " ")}</span>;
}

function MissionsView({ state, mutate, busyAction }: { state: WorkspaceState; mutate: Mutation; busyAction: string | null }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "normal", employeeId: "" });
  const attention = state.missions.filter((mission) => mission.status === "needs_review");
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-mission", form, `${form.title} was added to the mission queue.`);
    setForm({ title: "", description: "", priority: "normal", employeeId: "" });
    setShowCreate(false);
  };
  return <><PageHeading eyebrow="The work queue" title="Missions with an owner." subtitle="A mission is the durable unit between a human decision and an employee run. Run it, inspect the output, then approve what should become part of the operating record."><button className="button-primary" onClick={() => setShowCreate((value) => !value)} disabled={Boolean(busyAction)}><Plus size={13} />New mission</button></PageHeading>{showCreate ? <section className="panel form-card"><PanelHeader title="Create a mission" caption="No work is run until you explicitly press Run." /><form onSubmit={submit}><div className="field"><label htmlFor="mission-title">Title</label><input id="mission-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Prepare this week's customer update" /></div><div className="field"><label htmlFor="mission-description">What should happen?</label><textarea id="mission-description" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Give the assigned operator enough context to produce a useful result." /></div><div className="form-actions"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} aria-label="Mission priority"><option value="high">High priority</option><option value="normal">Normal priority</option><option value="low">Low priority</option></select><select value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} aria-label="Mission owner"><option value="">Unassigned</option>{state.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.title}</option>)}</select><button className="button-primary" type="submit">Create mission <ArrowUpRight size={13} /></button></div></form></section> : null}{attention.length ? <section className="panel"><PanelHeader title="Needs your decision" caption={`${attention.length} result${attention.length === 1 ? "" : "s"} waiting for review`}><span className="server-status"><Gauge size={13} color="var(--signal)" />Human approval</span></PanelHeader><div className="list-stack">{attention.map((mission) => <div className="list-item" key={mission.id}><div className="list-main"><div className="list-title">{mission.title}</div><div className="list-desc">{mission.output || "The operator returned no output."}</div><div className="list-meta">{state.employees.find((employee) => employee.id === mission.employeeId)?.name || "Unassigned"} · {relativeTime(mission.updatedAt)}</div></div><button className="button-primary" disabled={busyAction === "approve-mission"} onClick={() => void mutate("approve-mission", { missionId: mission.id }, `${mission.title} was approved.`)}><Check size={13} />{busyAction === "approve-mission" ? "Approving…" : "Approve"}</button></div>)}</div></section> : null}<section className="panel"><PanelHeader title="Mission queue" caption={`${state.missions.length} durable item${state.missions.length === 1 ? "" : "s"}`} /><div className="list-stack">{state.missions.length ? state.missions.map((mission) => { const owner = state.employees.find((employee) => employee.id === mission.employeeId); return <article className="list-item" key={mission.id}><div className="list-main"><div className="list-title"><span className={`priority-dot ${mission.priority}`} />{mission.title}</div><div className="list-desc">{mission.description}</div><div className="list-meta">{owner?.name || "Unassigned"} · {mission.dueAt ? `due ${relativeTime(mission.dueAt)}` : "no due date"}{mission.runId ? ` · run ${mission.runId.slice(0, 12)}` : ""}</div>{mission.output ? <div className="prompt-box mission-output">{mission.output}</div> : null}</div><div className="row-actions"><select value={mission.employeeId || ""} onChange={(event) => event.target.value && void mutate("delegate-mission", { missionId: mission.id, employeeId: event.target.value }, `${mission.title} was delegated.`)} aria-label={`Owner for ${mission.title}`} disabled={Boolean(busyAction)}><option value="">Unassigned</option>{state.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select>{mission.status === "ready" && owner ? <button className="small-button" disabled={Boolean(busyAction)} onClick={() => void mutate("run-mission", { missionId: mission.id }, `${mission.title} is running on ${owner.name}.`)}><Zap size={11} />{busyAction === "run-mission" ? "Running…" : "Run"}</button> : null}{mission.status === "needs_review" ? <button className="small-button ready" disabled={Boolean(busyAction)} onClick={() => void mutate("approve-mission", { missionId: mission.id }, `${mission.title} was approved.`)}><Check size={11} />{busyAction === "approve-mission" ? "Approving…" : "Approve"}</button> : null}<WorkflowStatus status={mission.status} /></div></article>; }) : <div className="empty-state">No missions yet. Start with a concrete decision or install a playbook.</div>}</div></section></>;
}

function ContentView({ state, mutate }: { state: WorkspaceState; mutate: Mutation }) {
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", objective: "", channel: "linkedin", employeeId: "" });
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-content", form, `${form.title} was added to the editorial queue.`);
    setForm({ title: "", objective: "", channel: "linkedin", employeeId: "" });
    setShowCreate(false);
  };
  const copyDraft = async (item: ContentItem) => {
    if (!item.body) return;
    try {
      await navigator.clipboard.writeText(item.body);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1800);
    } catch {
      setCopiedId(null);
    }
  };
  return <><PageHeading eyebrow="Editorial operations" title="Content with a source trail." subtitle="Draft from company context, review the claim, then approve it. Website and blog content can publish natively; external channels stay approved until their provider adapter is connected."><button className="button-primary" onClick={() => setShowCreate((value) => !value)}><Plus size={13} />New content</button></PageHeading>{showCreate ? <section className="panel form-card"><PanelHeader title="Add an editorial item" caption="The local worker can draft it after you save the brief." /><form onSubmit={submit}><div className="field"><label htmlFor="content-title">Title</label><input id="content-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. The hidden cost of invisible delivery work" /></div><div className="field"><label htmlFor="content-objective">Objective</label><textarea id="content-objective" required value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} placeholder="Who is this for and what should it help them understand?" /></div><div className="form-actions"><select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} aria-label="Content channel"><option value="linkedin">LinkedIn</option><option value="blog">Blog</option><option value="email">Email</option><option value="social">Social</option><option value="website">Website</option></select><select value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} aria-label="Content owner"><option value="">Content operator</option>{state.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select><button className="button-primary" type="submit">Save brief <ArrowUpRight size={13} /></button></div></form></section> : null}<section className="panel"><PanelHeader title="Editorial queue" caption={`${state.content.length} item${state.content.length === 1 ? "" : "s"} · draft → review → approve → schedule`} /><div className="list-stack">{state.content.length ? state.content.map((item) => { const owner = state.employees.find((employee) => employee.id === item.employeeId); const nativeDelivery = item.channel === "website" || item.channel === "blog"; return <article className="list-item" key={item.id}><div className="list-main"><div className="list-title"><span className="source-tag">{item.channel}</span>{item.title}</div><div className="list-desc">{item.objective}</div>{item.body ? <div className="prompt-box mission-output">{item.body}</div> : <div className="list-meta">No draft yet · grounded generation costs 2 AI Credits</div>}<div className="list-meta">{owner?.name || "Unassigned"} · updated {relativeTime(item.updatedAt)}{item.scheduledAt ? ` · scheduled ${relativeTime(item.scheduledAt)}` : ""}</div>{!nativeDelivery && item.body && ["approved", "scheduled"].includes(item.status) ? <div className="list-meta">Provider handoff required · this approved draft is not published by Perpendicular.</div> : null}</div><div className="row-actions">{item.status !== "published" ? <button className="small-button" onClick={() => void mutate("generate-content", { contentId: item.id }, `${item.title} was drafted from workspace context.`)}><PenLine size={11} />{item.body ? "Redraft" : "Draft"}</button> : null}{item.status === "review" ? <button className="small-button ready" onClick={() => void mutate("approve-content", { contentId: item.id }, `${item.title} was approved.`)}><Check size={11} />Approve</button> : null}{nativeDelivery && item.status === "approved" ? <button className="small-button" onClick={() => void mutate("schedule-content", { contentId: item.id }, `${item.title} was scheduled for the next editorial window.`)}><CalendarClock size={11} />Schedule</button> : null}{nativeDelivery && (item.status === "scheduled" || item.status === "approved") ? <button className="small-button" onClick={() => void mutate("publish-content", { contentId: item.id }, `${item.title} was published as a public page.`)}><ArrowUpRight size={11} />Publish</button> : null}{!nativeDelivery && item.body && ["approved", "scheduled"].includes(item.status) ? <button className="small-button ready" onClick={() => void copyDraft(item)}><ClipboardCheck size={11} />{copiedId === item.id ? "Copied" : "Copy draft"}</button> : null}<WorkflowStatus status={item.status} /></div></article>; }) : <div className="empty-state">No content yet. Add a brief and let a content operator make the first draft.</div>}</div></section></>;
}

function PlaybooksView({ state, mutate }: { state: WorkspaceState; mutate: Mutation }) {
  return <><PageHeading eyebrow="Reusable operating logic" title="Playbooks you can inspect." subtitle="Playbooks execute through a live employee, persist a scored result, and leave a mission ready for your review."><span className="server-status"><Plug size={13} color="var(--mint)" />Open catalog</span></PageHeading><div className="subpage-grid"><section className="panel"><PanelHeader title="Playbook catalog" caption={`${state.playbooks.length} local playbooks`} /><div className="list-stack">{state.playbooks.map((playbook: Playbook) => <article className="list-item" key={playbook.id}><div className="list-main"><div className="list-title"><span className="source-tag">{playbook.category}</span>{playbook.name}</div><div className="list-desc">{playbook.description}</div><div className="list-meta">{playbook.steps.length} steps · {playbook.installedAt ? `installed ${relativeTime(playbook.installedAt)}` : "not installed"}{playbook.lastRunAt ? ` · last run ${relativeTime(playbook.lastRunAt)}` : ""}</div><ol className="playbook-steps">{playbook.steps.map((step) => <li key={step}>{step}</li>)}</ol></div><div className="row-actions">{!playbook.installedAt ? <button className="small-button" onClick={() => void mutate("install-playbook", { playbookId: playbook.id }, `${playbook.name} was installed.`)}><Plus size={11} />Install</button> : <button className="small-button ready" onClick={() => void mutate("run-playbook", { playbookId: playbook.id }, `${playbook.name} completed and is ready for review.`)} disabled={!state.employees.some((employee) => employee.status === "live")}><Zap size={11} />Run</button>}</div></article>)}</div></section><section className="panel form-card"><h3>What a playbook does</h3><p>The selected employee runs every visible step against grounded workspace context. The result is scored, saved in Activity and Missions, and held for approval before any external action.</p><div className="setting-row"><div><div className="setting-name">No hidden external sends</div><div className="setting-description">Email, publishing, and channel actions stay behind explicit integration gates.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">Reviewable output</div><div className="setting-description">Every run leaves a trace and a mission you can inspect before approving the next step.</div></div><Check size={15} color="var(--mint)" /></div></section></div></>;
}

function OnboardingView({ state, viewer, mutate, busyAction }: { state: WorkspaceState; viewer: Viewer | null; mutate: Mutation; busyAction: string | null }) {
  const onboarding = state.workspace.onboarding;
  const [goal, setGoal] = useState<OnboardingGoal>(onboarding.goal || "revenue");
  const inferredUrl = viewer?.email.split("@")[1] && !["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"].includes(viewer.email.split("@")[1].toLowerCase())
    ? `https://${viewer.email.split("@")[1].toLowerCase()}`
    : "";
  const [companyUrl, setCompanyUrl] = useState(onboarding.companyUrl || inferredUrl);
  const [companyDescription, setCompanyDescription] = useState("");
  const autoStarted = useRef(false);
  const goalOptions: Array<{ id: OnboardingGoal; label: string; detail: string }> = [
    { id: "revenue", label: "Find more revenue", detail: "Prioritize pipeline, positioning, and next moves." },
    { id: "delivery", label: "Run delivery better", detail: "Turn active work into clear owners and deadlines." },
    { id: "content", label: "Ship better content", detail: "Build a grounded content rhythm from your real voice." },
    { id: "support", label: "Protect customer experience", detail: "Spot support risks and make the next response obvious." },
  ];
  const discovering = busyAction === "bootstrap-workspace";
  const researching = busyAction === "run-lead-source";
  const briefing = busyAction === "run-onboarding-brief";
  const scheduling = busyAction === "enable-onboarding-schedule";
  const finishing = busyAction === "finish-onboarding";
  const operator = onboarding.employeeId ? state.employees.find((employee) => employee.id === onboarding.employeeId) : null;
  const firstRun = onboarding.runId ? state.runs.find((run) => run.id === onboarding.runId) : null;
  const source = onboarding.documentId ? state.documents.find((document) => document.id === onboarding.documentId) : null;
  const onboardingContent = state.content.filter((item) => onboarding.contentIds.includes(item.id));
  const onboardingSequence = state.sequences.find((sequence) => sequence.id.startsWith("seq-onboarding-") || sequence.name.includes("first conversation"));
  const onboardingLeadSource = state.leadSources.find((leadSource) => leadSource.type === "public");
  const gmail = state.integrations?.find((integration) => integration.provider === "gmail");
  const gmailConnected = gmail?.status === "connected";
  const gmailConfigured = gmail?.status !== "not_configured";
  const discoverWorkspace = useCallback(async () => {
    const discovered = await mutate("bootstrap-workspace", { goal, companyUrl: companyUrl.trim(), companyDescription: companyDescription.trim() }, "Workspace discovered. Running the first grounded brief…");
    if (!discovered) return;
    const source = discovered.leadSources.find((candidate) => candidate.type === "public" && candidate.status === "ready");
    if (source && !await mutate("run-lead-source", { sourceId: source.id }, "Public research captured. Running the first grounded brief…")) return;
    await mutate("run-onboarding-brief", {}, "Workspace discovered and the first grounded brief is ready.");
  }, [companyDescription, companyUrl, goal, mutate]);

  useEffect(() => {
    if (onboarding.status !== "not_started" || !inferredUrl || autoStarted.current || busyAction) return;
    autoStarted.current = true;
    void discoverWorkspace();
  }, [busyAction, discoverWorkspace, inferredUrl, onboarding.status]);

  if (onboarding.status === "ready" && (researching || briefing)) {
    return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">Discovery complete</div><h1 className="page-title">Building your first useful queue.</h1><p className="page-subtitle">The workspace is saved. Perpendicular is finishing the public research and grounded brief before it asks you to run anything.</p><div className="onboarding-steps"><div className="onboarding-step complete"><span>✓</span><div><strong>Discover</strong><small>Source indexed</small></div></div><div className="onboarding-step active"><span>02</span><div><strong>{researching ? "Research" : "Prepare"}</strong><small>{researching ? "Capturing public signals" : "Writing the first brief"}</small></div></div><div className="onboarding-step"><span>03</span><div><strong>Prove</strong><small>Run a grounded mission</small></div></div></div></div><section className="onboarding-card"><div className="onboarding-progress" role="status" aria-live="polite"><span className="action-spinner" /><div><strong>{researching ? "Capturing public research…" : "Preparing the first grounded brief…"}</strong><p>This can take a moment on the Dell. Keep this tab open; the next screen will show the saved result.</p></div></div></section></div>;
  }

  if (onboarding.status === "not_started") {
    return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">Perpendicular setup</div><h1 className="page-title">Let the system learn the work.</h1><p className="page-subtitle">Perpendicular reads one real public source, builds a small operator pod, captures public research, and proves the loop before asking you to automate anything.</p><div className="onboarding-steps"><div className="onboarding-step active"><span>01</span><div><strong>Discover</strong><small>Read your real context</small></div></div><div className="onboarding-step"><span>02</span><div><strong>Prove</strong><small>Run a grounded mission</small></div></div><div className="onboarding-step"><span>03</span><div><strong>Repeat</strong><small>Turn on the daily rhythm</small></div></div></div></div><section className="onboarding-card"><div className="onboarding-card-heading"><div><div className="eyebrow">One source. A working pod. A decision queue.</div><h2>{inferredUrl ? "We found your company. Starting there." : "What should Perpendicular own first?"}</h2></div><span className="onboarding-badge">No fake data</span></div><div className="goal-grid">{goalOptions.map((option) => <button className={`goal-option ${goal === option.id ? "selected" : ""}`} onClick={() => setGoal(option.id)} key={option.id}><span className="goal-radio" /> <span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</div><div className="field"><label htmlFor="onboarding-url">Public company URL</label><input id="onboarding-url" type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} placeholder="https://yourcompany.com" /><small className="field-hint">{inferredUrl ? "This was inferred from your workspace email. We only inspect public text." : "We inspect only this public page. No credentials or private mailbox data is read."}</small></div><div className="field"><label htmlFor="onboarding-description">If you do not have a public site, describe the work</label><textarea id="onboarding-description" value={companyDescription} onChange={(event) => setCompanyDescription(event.target.value)} placeholder="Optional fallback: what your team sells, who it serves, and what is currently stuck." /></div><button className="button-primary onboarding-submit" disabled={discovering || researching || briefing || (!companyUrl.trim() && companyDescription.trim().length < 40)} onClick={() => void discoverWorkspace()}>{discovering ? "Reading your workspace…" : researching ? "Capturing public research…" : briefing ? "Running the first brief…" : "Discover and start my workspace"}<ArrowUpRight size={13} /></button><p className="onboarding-footnote">This creates the knowledge source, four scoped operators, three content briefs, a real public research source, a mission queue, a ready-to-fill lead workspace, and a live public operator page in your Dell-backed workspace. It does not invent contacts or send email.</p></section></div>;
  }

  if (onboarding.status === "ready") {
    return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">Discovery complete</div><h1 className="page-title">Your operator pod is ready.</h1><p className="page-subtitle">The source below was fetched and persisted on the Dell. Review the scope, then run the first mission through your local model.</p><div className="onboarding-steps"><div className="onboarding-step complete"><span>✓</span><div><strong>Discover</strong><small>Source indexed</small></div></div><div className="onboarding-step active"><span>02</span><div><strong>Prove</strong><small>Run a grounded mission</small></div></div><div className="onboarding-step"><span>03</span><div><strong>Repeat</strong><small>Turn on the daily rhythm</small></div></div></div></div><section className="onboarding-card"><div className="discovery-summary"><div className="discovery-icon">{operator?.avatar || "AI"}</div><div><div className="eyebrow">{state.employees.length} scoped operators</div><h2>{operator?.name || "Your operator"} · {operator?.title || "Workspace operator"}</h2><p>{operator?.systemPrompt}</p></div></div><div className="discovery-facts"><div><span>Source</span><strong>{source?.name || onboarding.sourceTitle || "Indexed workspace source"}</strong><small>{source?.chunks || 0} chunks · {source?.source === "url" ? "public URL" : "operator brief"}</small></div><div><span>Work queue</span><strong>{state.missions.length} missions</strong><small>{state.missions.filter((mission) => mission.status === "ready").length} ready to run · review stays human</small></div><div><span>Lead workspace</span><strong>{state.lists[0]?.name || "Ready for contacts"}</strong><small>{state.lists[0]?.rows.length || 0} real rows · import or add contacts to begin</small></div><div><span>Public operator</span>{state.sites[0] ? <a href={`/site/${state.sites[0].slug}`} target="_blank" rel="noreferrer"><strong>Open live page</strong></a> : <strong>Not configured</strong>}<small>Grounded visitor chat · no outbound mail</small></div></div><div className="onboarding-action-row"><button className="button-primary" disabled={briefing} onClick={() => void mutate("run-onboarding-brief", {}, "First mission completed and scored.")}>{briefing ? "Running the local operator…" : "Run my first mission"}<Zap size={13} /></button></div><p className="onboarding-footnote">The first mission is the proof step. If Ollama is unavailable, Perpendicular will stop and tell you instead of showing a made-up result.</p></section></div>;
  }

  return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">First proof complete</div><h1 className="page-title">Now make it repeat.</h1><p className="page-subtitle">{operator?.name || "Your operator"} produced a persisted run with a score and trace. Keep it manual, or let the Dell wake it once a day.</p><div className="onboarding-steps"><div className="onboarding-step complete"><span>✓</span><div><strong>Discover</strong><small>Source indexed</small></div></div><div className="onboarding-step complete"><span>✓</span><div><strong>Prove</strong><small>Run scored</small></div></div><div className={`onboarding-step ${onboarding.scheduleEnabled ? "complete" : "active"}`}><span>{onboarding.scheduleEnabled ? "✓" : "03"}</span><div><strong>Repeat</strong><small>{onboarding.scheduleEnabled ? "Daily rhythm on" : "Optional daily rhythm"}</small></div></div></div></div><section className="onboarding-card"><div className="run-proof"><div className="run-proof-head"><div><div className="eyebrow">Persisted run · {firstRun?.trigger || "manual"}</div><h2>{firstRun?.task || "First workspace brief"}</h2></div><div className="proof-score">{firstRun?.score ?? "—"}<small>score</small></div></div><div className="run-proof-output">{firstRun?.output || "The run completed, but its output could not be loaded."}</div><div className="trace-strip">{(firstRun?.trace || []).map((step) => <span key={step.label}><Check size={11} />{step.label}<small>{step.durationMs}ms · {step.cost} credit</small></span>)}</div></div><div className="discovery-facts"><div><span>Content plan</span><strong>{onboardingContent.filter((item) => item.body).length} drafts ready</strong><small>{onboardingContent.length} briefs · review in Content</small></div><div><span>Lead research</span><strong>{onboardingLeadSource?.recordCount || 0} public matches</strong><small>{onboardingLeadSource?.lastSummary || "Review Lead Data to start"}</small></div><div><span>Sales sequence</span><strong>{onboardingSequence?.steps.length || 0} steps drafted</strong>{gmailConnected ? <small>{gmail?.accountEmail || "Gmail"} connected · sends remain human-approved</small> : gmailConfigured ? <a className="onboarding-link" href={apiPath("/api/integrations/google/start")}><strong>Connect Gmail</strong></a> : <small>Gmail OAuth is not configured on the Dell</small>}</div><div><span>Public operator</span>{state.sites[0] ? <a href={`/site/${state.sites[0].slug}`} target="_blank" rel="noreferrer"><strong>Open live page</strong></a> : <strong>Not configured</strong>}<small>Grounded visitor chat · no outbound mail</small></div></div><div className="onboarding-action-row"><button className="button-primary" disabled={scheduling || onboarding.scheduleEnabled} onClick={() => void mutate("enable-onboarding-schedule", {}, "Daily rhythm enabled on the Dell heartbeat.")}>{scheduling ? "Enabling rhythm…" : onboarding.scheduleEnabled ? "Daily rhythm enabled" : "Keep this running daily"}<CalendarClock size={13} /></button><button className="button-secondary" disabled={finishing} onClick={() => void mutate("finish-onboarding", {}, "Workspace ready. You are in the workbench.")}>{finishing ? "Opening workbench…" : "Open workbench"}<ArrowUpRight size={13} /></button></div><p className="onboarding-footnote">Daily rhythm is optional. You can change or pause it from Employees. Gmail remains approval-gated until you explicitly connect and test it.</p></section></div>;
}

function WidgetSettingsCard({ state }: { state: WorkspaceState }) {
  const [enabled, setEnabled] = useState(Boolean(state.widget?.enabled));
  const [employeeId, setEmployeeId] = useState(state.widget?.employeeId || state.employees.find((employee) => employee.status === "live")?.id || "");
  const [greeting, setGreeting] = useState(state.widget?.greeting || "");
  const [widgetKey, setWidgetKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const widgetOrigin = canonicalOrigin || (typeof window === "undefined" ? "" : window.location.origin);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "configure-widget", enabled, employeeId: employeeId || null, greeting }) });
      const payload = await response.json().catch(() => ({})) as { widget?: { key?: string | null; enabled?: boolean }; error?: string };
      if (!response.ok || !payload.widget) throw new Error(payload.error || "The widget could not be configured.");
      setWidgetKey(payload.widget.key || null);
      setMessage(payload.widget.enabled ? "Widget enabled. Copy the embed URL now; the key is only revealed here." : "Widget disabled. Existing embed URLs no longer work.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The widget could not be configured.");
    } finally {
      setBusy(false);
    }
  };

  const embedUrl = widgetKey ? `${widgetOrigin}/widget/${encodeURIComponent(state.workspace.id)}?key=${encodeURIComponent(widgetKey)}` : null;
  return <section className="panel"><PanelHeader title="Inbound website widget" caption="A public, capability-keyed assistant grounded in this workspace." /><div className="form-card"><label className="checkbox-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Accept website conversations</label><div className="field"><label htmlFor="widget-operator">Operator</label><select id="widget-operator" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} disabled={!state.employees.length}>{state.employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.title}</option>)}</select></div><div className="field"><label htmlFor="widget-greeting">Greeting</label><textarea id="widget-greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} maxLength={500} /></div><button className="button-primary" type="button" onClick={() => void save()} disabled={busy || (enabled && !employeeId)}>{busy ? "Saving…" : "Generate secure widget URL"}<ArrowUpRight size={13} /></button>{message ? <div className="list-meta" role="status">{message}</div> : null}{embedUrl ? <div className="key-reveal"><div><strong>Embed URL</strong><p>Use it as an iframe on any site you control.</p></div><code>{embedUrl}</code><button className="small-button" type="button" onClick={() => void navigator.clipboard?.writeText(embedUrl)}>Copy</button></div> : null}</div></section>;
}

function OutboundSafetyCard({ state }: { state: WorkspaceState }) {
  const [settings, setSettings] = useState<OutboundSafetySettings>(state.outboundSafety);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timezones = ["UTC", "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Australia/Sydney"];

  const saveSettings = async (next: OutboundSafetySettings) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-outbound-safety", dailySendLimit: next.dailySendLimit, timezone: next.timezone, sendWindowStart: next.sendWindowStart, sendWindowEnd: next.sendWindowEnd, skipWeekends: next.skipWeekends }) });
      const payload = await response.json().catch(() => ({})) as WorkspaceState & { error?: string };
      if (!response.ok || !payload.outboundSafety) throw new Error(payload.error || "Outbound safety settings could not be saved.");
      setSettings(payload.outboundSafety);
      setMessage("Outbound safety saved. New Gmail sends will use these rules.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Outbound safety settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const suppressDomain = async () => {
    const value = domain.trim().toLowerCase().replace(/^@+/, "");
    if (!value) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "suppress-domain", domain: value }) });
      const payload = await response.json().catch(() => ({})) as WorkspaceState & { error?: string };
      if (!response.ok || !payload.outboundSafety) throw new Error(payload.error || "The domain could not be suppressed.");
      setSettings(payload.outboundSafety);
      setDomain("");
      setMessage(`${value} is now suppressed for this workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The domain could not be suppressed.");
    } finally {
      setBusy(false);
    }
  };

  const unsuppressDomain = async (value: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsuppress-domain", domain: value }) });
      const payload = await response.json().catch(() => ({})) as WorkspaceState & { error?: string };
      if (!response.ok || !payload.outboundSafety) throw new Error(payload.error || "The domain could not be unsuppressed.");
      setSettings(payload.outboundSafety);
      setMessage(`${value} was removed from domain suppression.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The domain could not be unsuppressed.");
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<OutboundSafetySettings>) => setSettings((current) => ({ ...current, ...patch }));
  return <section className="panel"><PanelHeader title="Outbound safety" caption="Persisted guardrails applied before every Gmail send." /><div className="form-card"><div className="form-grid"><div className="field"><label htmlFor="daily-send-limit">Daily send limit</label><input id="daily-send-limit" type="number" min={1} max={10000} value={settings.dailySendLimit} onChange={(event) => update({ dailySendLimit: Number(event.target.value) })} /><small className="field-hint">Counts successful sends in this workspace&apos;s local day.</small></div><div className="field"><label htmlFor="send-timezone">Timezone</label><select id="send-timezone" value={settings.timezone} onChange={(event) => update({ timezone: event.target.value })}>{!timezones.includes(settings.timezone) ? <option value={settings.timezone}>{settings.timezone}</option> : null}{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></div></div><div className="form-grid"><div className="field"><label htmlFor="send-window-start">Window starts</label><input id="send-window-start" type="time" value={settings.sendWindowStart} onChange={(event) => update({ sendWindowStart: event.target.value })} /></div><div className="field"><label htmlFor="send-window-end">Window ends</label><input id="send-window-end" type="time" value={settings.sendWindowEnd} onChange={(event) => update({ sendWindowEnd: event.target.value })} /></div></div><label className="checkbox-row"><input type="checkbox" checked={settings.skipWeekends} onChange={(event) => update({ skipWeekends: event.target.checked })} /> Skip Saturday and Sunday</label><button className="button-primary" type="button" onClick={() => void saveSettings(settings)} disabled={busy}>{busy ? "Saving…" : "Save outbound rules"}<ShieldCheck size={13} /></button><div className="setting-description">Perpendicular does not pretend to provide SPF, DKIM, DMARC, warmup, bounce, or complaint verification. Those still belong to your mail provider and DNS. These controls govern what this workspace is allowed to send.</div><div className="field"><label htmlFor="suppressed-domain">Suppress a domain</label><div className="form-actions"><input id="suppressed-domain" type="text" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void suppressDomain(); } }} /><button className="button-secondary" type="button" onClick={() => void suppressDomain()} disabled={busy || !domain.trim()}>Suppress</button></div></div>{settings.suppressedDomains.length ? <div className="health-log">{settings.suppressedDomains.map((value) => <div className="setting-row" key={value}><div><div className="setting-name">{value}</div><div className="setting-description">This domain and its subdomains are blocked.</div></div><button className="small-button" type="button" onClick={() => void unsuppressDomain(value)} disabled={busy}>Remove</button></div>)}</div> : <div className="list-meta">No suppressed domains. Individual email suppression remains available from Smart Lists.</div>}{message ? <div className="list-meta" role="status">{message}</div> : null}</div></section>;
}

function DeliverabilityCard({ state }: { state: WorkspaceState }) {
  const [domain, setDomain] = useState(() => state.profile.website?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "");
  const [dkimSelector, setDkimSelector] = useState("");
  const [checks, setChecks] = useState<DeliverabilityCheck[]>(state.deliverabilityChecks || []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check-deliverability", domain, dkimSelector }) });
      const payload = await response.json().catch(() => ({})) as WorkspaceState & { error?: string };
      if (!response.ok || !payload.deliverabilityChecks) throw new Error(payload.error || "Deliverability could not be checked.");
      setChecks(payload.deliverabilityChecks);
      setMessage(`Checked ${domain}. DNS results are persisted in this workspace.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deliverability could not be checked.");
    } finally {
      setBusy(false);
    }
  };
  const latest = checks[0];
  const record = (label: string, item: DeliverabilityCheck["mx"]) => {
    const status = item.status;
    return <div className="setting-row" key={label}><div><div className="setting-name">{label}</div><div className="setting-description">{item.detail}</div>{item.values.length ? <div className="list-meta">{item.values.join(" · ")}</div> : null}</div><span className={`status-pill ${status === "pass" ? "live" : status === "missing" ? "paused" : ""}`}>{status}</span></div>;
  };
  return <section className="panel"><PanelHeader title="Deliverability diagnostics" caption="Real DNS checks from the Dell. No warmup or inbox guarantee is implied." /><div className="form-card"><div className="form-grid"><div className="field"><label htmlFor="deliverability-domain">Sending domain</label><input id="deliverability-domain" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" /></div><div className="field"><label htmlFor="deliverability-dkim-selector">DKIM selector <span className="field-hint">optional</span></label><input id="deliverability-dkim-selector" value={dkimSelector} onChange={(event) => setDkimSelector(event.target.value)} placeholder="google" /></div></div><button className="button-primary" type="button" onClick={() => void run()} disabled={busy || !domain.trim()}>{busy ? "Checking DNS…" : "Check domain health"}<ShieldCheck size={13} /></button>{message ? <div className="list-meta" role="status">{message}</div> : null}</div>{latest ? <div className="health-log">{record("MX", latest.mx)}{record("SPF", latest.spf)}{record("DMARC", latest.dmarc)}{record("DKIM", latest.dkim)}<div className="list-meta">Last checked {relativeTime(latest.checkedAt)} · bounce and delivery-failure messages are automatically quarantined by Gmail sync.</div></div> : <div className="empty-state">Check the domain used by your connected Gmail mailbox to see its actual MX, SPF, DMARC, and optional DKIM records.</div>}</section>;
}

function SettingsView({ state, usage }: { state: WorkspaceState; usage: UsageSummary | null }) {
  const rawGmail = state.integrations?.find((integration) => integration.provider === "gmail");
  const gmailNotConfigured = rawGmail?.status === "not_configured";
  const gmail = rawGmail?.status === "not_configured"
    ? { ...rawGmail, status: "disconnected" as const }
    : rawGmail;
  const [testRecipient, setTestRecipient] = useState("");
  const [gmailBusy, setGmailBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [apiKeyName, setApiKeyName] = useState("SDK access");
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>(["workspace:read", "workspace:write"]);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const aiForecast = usage ? creditForecast({ limit: state.workspace.aiCredits.limit, remaining: state.workspace.aiCredits.remaining, used: usage.aiUnits, periodStart: usage.periodStart }) : null;
  const dataForecast = usage ? creditForecast({ limit: state.workspace.dataCredits.purchased, remaining: state.workspace.dataCredits.remaining, used: usage.dataUnits, periodStart: usage.periodStart }) : null;
  useEffect(() => {
    fetch(apiPath("/api/ops"), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Operations data could not be loaded."));
        setOps(await response.json() as OpsSummary);
      })
      .catch((error: unknown) => setSettingsMessage(error instanceof Error ? error.message : "Operations data could not be loaded."));
  }, []);
  useEffect(() => {
    fetch(apiPath("/api/keys"), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "API keys could not be loaded."));
        const payload = await response.json() as { keys?: ApiKeySummary[] };
        setApiKeys(payload.keys || []);
      })
      .catch((error: unknown) => setSettingsMessage(error instanceof Error ? error.message : "API keys could not be loaded."));
  }, []);
  const createApiKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiKeyBusy(true);
    setNewApiKey(null);
    try {
      const response = await fetch(apiPath("/api/keys"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: apiKeyName, scopes: apiKeyScopes }) });
      const payload = await response.json().catch(() => ({})) as ApiKeySummary & { secret?: string; error?: string; warning?: string };
      if (!response.ok || !payload.secret) throw new Error(payload.error || "API key could not be created.");
      setNewApiKey(payload.secret);
      setApiKeys((current) => [{ id: payload.id, name: payload.name, keyPrefix: payload.keyPrefix, scopes: payload.scopes, createdAt: payload.createdAt, lastUsedAt: payload.lastUsedAt || null }, ...current]);
      setSettingsMessage(payload.warning || "API key created. Copy it now; it will not be shown again.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "API key could not be created.");
    } finally {
      setApiKeyBusy(false);
    }
  };
  const revokeApiKey = async (id: string, name: string) => {
    if (!window.confirm(`Revoke ${name}? Existing clients will stop working immediately.`)) return;
    setApiKeyBusy(true);
    try {
      const response = await fetch(apiPath(`/api/keys/${encodeURIComponent(id)}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "API key could not be revoked."));
      setApiKeys((current) => current.filter((key) => key.id !== id));
      setSettingsMessage(`${name} was revoked.`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "API key could not be revoked.");
    } finally {
      setApiKeyBusy(false);
    }
  };
  const toggleApiKeyScope = (scope: string) => setApiKeyScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  const disconnectGmail = async () => {
    setSettingsMessage(null);
    setGmailBusy(true);
    try {
      const response = await fetch(apiPath("/api/integrations/gmail/disconnect"), { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Gmail could not be disconnected."));
      window.location.reload();
    } catch (error) {
      setGmailBusy(false);
      setSettingsMessage(error instanceof Error ? error.message : "Gmail could not be disconnected.");
    }
  };
  const syncGmail = async () => {
    setSettingsMessage(null);
    setGmailBusy(true);
    try {
      const response = await fetch(apiPath("/api/integrations/gmail/sync"), { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Gmail inbox sync failed."));
      window.location.reload();
    } catch (error) {
      setGmailBusy(false);
      setSettingsMessage(error instanceof Error ? error.message : "Gmail inbox sync failed.");
    }
  };
  const renewGmailWatch = async () => {
    setSettingsMessage(null);
    setGmailBusy(true);
    try {
      const response = await fetch(apiPath("/api/integrations/gmail/watch"), { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Gmail watch renewal failed."));
      window.location.reload();
    } catch (error) {
      setGmailBusy(false);
      setSettingsMessage(error instanceof Error ? error.message : "Gmail watch renewal failed.");
    }
  };
  const sendTest = async () => {
    if (!testRecipient || !window.confirm(`Send a real test email to ${testRecipient}?`)) return;
    setSettingsMessage(null);
    setGmailBusy(true);
    try {
      const response = await fetch(apiPath("/api/integrations/gmail/test"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testRecipient }) });
      const payload = await response.json().catch(() => null) as { warning?: string } | null;
      if (!response.ok) throw new Error(payload?.warning || await responseError(response, "The test email could not be sent."));
      setSettingsMessage(payload?.warning ? `Test email sent to ${testRecipient}. ${payload.warning}` : `Test email sent to ${testRecipient}.`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "The test email could not be sent.");
    } finally {
      setGmailBusy(false);
    }
  };
  const deleteWorkspace = async () => {
    if (!window.confirm(`This permanently deletes all data for ${state.workspace.id}. Continue?`)) return;
    const confirmation = window.prompt(`Type ${state.workspace.id} to permanently delete this workspace.`);
    if (confirmation !== state.workspace.id) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(apiPath("/api/workspace/privacy"), { method: "DELETE", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation }) });
      if (!response.ok) throw new Error(await responseError(response, "Workspace data could not be deleted."));
      window.location.reload();
    } catch (error) {
      setDeleteBusy(false);
      setSettingsMessage(error instanceof Error ? error.message : "Workspace data could not be deleted.");
    }
  };
  const operate = async (action: "replay-webhook" | "retry-job", id: string) => {
    setSettingsMessage(null);
    setOpsBusy(`${action}:${id}`);
    try {
      const response = await fetch(apiPath("/api/ops"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id }) });
      if (!response.ok) throw new Error(await responseError(response, "The operations action failed."));
      const refreshed = await fetch(apiPath("/api/ops"), { credentials: "include" });
      if (!refreshed.ok) throw new Error(await responseError(refreshed, "Operations data could not be refreshed."));
      setOps(await refreshed.json() as OpsSummary);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "The operations action failed.");
    } finally {
      setOpsBusy(null);
    }
  };

  return <>
    <PageHeading eyebrow="Operator controls" title="Open by default." subtitle="No paid model API is required to run this workspace. The runtime is designed for the Dell, with Postgres persistence and Ollama as the local worker.">
      <span className="status-pill live"><span className="status-dot" />{state.workspace.plan}</span>
    </PageHeading>
    {settingsMessage ? <div className="notice" role="alert">{settingsMessage}</div> : null}
    <div className="settings-grid">
      <OutboundSafetyCard state={state} />
      <DeliverabilityCard state={state} />
      <WidgetSettingsCard state={state} />
      <section className="panel">
        <PanelHeader title="Workspace contract" caption={`Company boundary: ${state.workspace.id}`} />
        <div>
          <div className="setting-row"><div><div className="setting-name">Runtime region</div><div className="setting-description">Where the app and data are expected to live.</div></div><div className="setting-value">{state.workspace.region}</div></div>
          <div className="setting-row"><div><div className="setting-name">Worker model</div><div className="setting-description">Swap with any Ollama-compatible open model.</div></div><div className="setting-value">{state.workspace.model}</div></div>
          <div className="setting-row"><div><div className="setting-name">AI credits</div><div className="setting-description">Local worker budget for chat and scheduled actions.</div></div><div className="setting-value">{state.workspace.aiCredits.remaining} / {state.workspace.aiCredits.limit}</div></div>
          <div className="setting-row"><div><div className="setting-name">Data credits</div><div className="setting-description">Local budget for public company research.</div></div><div className="setting-value">{state.workspace.dataCredits.remaining}</div></div>
        </div>
      </section>
      <section className="panel">
        <PanelHeader title="Developer access" caption="Create a scoped key for OpenAI-compatible, Anthropic, and REST clients." />
        <form className="form-card" onSubmit={(event) => void createApiKey(event)}>
          <div className="field"><label htmlFor="api-key-name">Key name</label><input id="api-key-name" value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} placeholder="e.g. Claude Code" required maxLength={80} /></div>
          <div className="field"><span className="field-label">Permissions</span><label className="checkbox-row"><input type="checkbox" checked={apiKeyScopes.includes("workspace:read")} onChange={() => toggleApiKeyScope("workspace:read")} /> Read workspace</label><label className="checkbox-row"><input type="checkbox" checked={apiKeyScopes.includes("workspace:write")} onChange={() => toggleApiKeyScope("workspace:write")} /> Run employees and write work</label></div>
          <button className="button-primary" type="submit" disabled={apiKeyBusy || !apiKeyScopes.length}>{apiKeyBusy ? "Creating…" : "Create API key"}<ArrowUpRight size={13} /></button>
        </form>
        {newApiKey ? <div className="key-reveal" role="status"><div><strong>Copy this key now</strong><p>It will never be shown again.</p></div><code>{newApiKey}</code><button className="small-button" onClick={() => void navigator.clipboard?.writeText(newApiKey)}>Copy</button></div> : null}
        {apiKeys.length ? <div className="key-list">{apiKeys.map((key) => <div className="setting-row" key={key.id}><div><div className="setting-name">{key.name}</div><div className="setting-description"><code>{key.keyPrefix}…</code> · {key.scopes.join(", ")}</div></div><button className="small-button" disabled={apiKeyBusy} onClick={() => void revokeApiKey(key.id, key.name)}>Revoke</button></div>)}</div> : <div className="list-meta">No active API keys yet.</div>}
      </section>
      <section className="panel">
        <PanelHeader title="Usage ledger" caption="Persisted credit burn for the last 30 days." />
        <div className="setting-row"><div><div className="setting-name">AI usage</div><div className="setting-description">Chat, runs, evaluations, and heartbeat work.</div></div><div className="setting-value">{usage ? usage.aiUnits : "Unavailable"}</div></div>
        <div className="setting-row"><div><div className="setting-name">Data usage</div><div className="setting-description">Public research actions only.</div></div><div className="setting-value">{usage ? usage.dataUnits : "Unavailable"}</div></div>
        {aiForecast?.dailyBurn ? <div className="setting-row"><div><div className="setting-name">AI burn forecast</div><div className="setting-description">{aiForecast.dailyBurn.toFixed(1)} credits/day · 90% threshold</div></div><div className="setting-value">{forecastDate(aiForecast.ninetyPercentAt)}</div></div> : null}
        {dataForecast?.dailyBurn ? <div className="setting-row"><div><div className="setting-name">Data burn forecast</div><div className="setting-description">{dataForecast.dailyBurn.toFixed(1)} credits/day · 90% threshold</div></div><div className="setting-value">{forecastDate(dataForecast.ninetyPercentAt)}</div></div> : null}
        {aiForecast?.exhaustedAt ? <div className="list-meta">At the current AI burn, the remaining budget reaches zero around {forecastDate(aiForecast.exhaustedAt)}.</div> : null}
        {usage?.byFeature.length ? <div className="health-log">{usage.byFeature.slice(0, 8).map((entry) => <div className="list-meta" key={entry.feature}>{entry.feature} · {entry.units} units</div>)}</div> : <div className="list-meta">Usage appears after db/004_usage_ledger.sql is applied and a real action runs.</div>}
      </section>
      <section className="panel">
        <PanelHeader title="Operations" caption="Workspace-scoped webhooks and dead-letter work." />
        <div className="setting-row"><div><div className="setting-name">Webhook events</div><div className="setting-description">Provider events are persisted before processing and can be replayed after a failure.</div></div><div className="setting-value">{ops?.webhooks.length ?? "—"}</div></div>
        {ops?.webhooks.slice(0, 5).map((event) => <div className="setting-row" key={event.id}><div><div className="setting-name">{event.provider} · {event.eventType}</div><div className="setting-description">{event.error || `${event.status} · ${relativeTime(event.createdAt)}`}</div></div><div className="row-actions">{event.status === "failed" || event.status === "processed" ? <button className="small-button" disabled={opsBusy === `replay-webhook:${event.id}`} onClick={() => void operate("replay-webhook", event.id)}>{opsBusy === `replay-webhook:${event.id}` ? "Replaying…" : "Replay"}</button> : <span className="small-button">{event.status}</span>}</div></div>)}
        <div className="setting-row"><div><div className="setting-name">Dead-letter jobs</div><div className="setting-description">Failed heartbeat jobs can be requeued without editing the database.</div></div><div className="setting-value">{ops?.deadLetterJobs.length ?? "—"}</div></div>
        {ops?.deadLetterJobs.slice(0, 5).map((job) => <div className="setting-row" key={job.id}><div><div className="setting-name">{job.kind}</div><div className="setting-description">{job.lastError || `${job.attempts}/${job.maxAttempts} attempts`}</div></div><button className="small-button" disabled={opsBusy === `retry-job:${job.id}`} onClick={() => void operate("retry-job", job.id)}>{opsBusy === `retry-job:${job.id}` ? "Retrying…" : "Retry"}</button></div>)}
        {!ops ? <div className="list-meta">Operations data is unavailable until the platform migrations are applied.</div> : null}
      </section>
      <section className="panel">
        <PanelHeader title="Connections" caption="Credentials are kept on the Dell and never returned to the browser." />
        <div className="setting-row"><div><div className="setting-name"><Mail size={14} /> Gmail</div><div className="setting-description">OAuth mailbox for explicit tests, inbox sync, and approved sequence sends.</div>{gmail?.accountEmail ? <div className="list-meta">{gmail.accountEmail} · {gmail.lastSyncAt ? `synced ${relativeTime(gmail.lastSyncAt)}` : "not synced yet"}</div> : null}{gmail?.status === "degraded" ? <div className="list-meta warning-text">Mailbox access is incomplete. Reconnect and grant Gmail send/read permission before using inbox or sequences.</div> : null}</div>{gmail?.status === "connected" ? <div className="row-actions"><button className="small-button" disabled={gmailBusy} onClick={() => void syncGmail()}>Sync inbox</button><button className="small-button" disabled={gmailBusy} onClick={() => void renewGmailWatch()}>Renew watch</button><button className="small-button" disabled={gmailBusy} onClick={() => void disconnectGmail()}>Disconnect</button></div> : gmailNotConfigured ? <div className="list-meta">Gmail OAuth is not configured on the Dell.</div> : <a className="button-secondary" href={apiPath("/api/integrations/google/start")}><Mail size={13} />Reconnect Gmail</a>}</div>
        {gmail?.status === "connected" ? <div className="form-actions"><input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} placeholder="your test address" aria-label="Test email recipient" /><button className="button-secondary" disabled={gmailBusy || !testRecipient} onClick={() => void sendTest()}>Send test email</button></div> : null}
        {gmail?.health?.length ? <div className="health-log">{gmail.health.slice(0, 5).map((event) => <div className="list-meta" key={`${event.createdAt}-${event.eventType}`}>{event.status} · {event.eventType} · {event.detail} · {relativeTime(event.createdAt)}</div>)}</div> : null}
        <div className="setting-row"><div><div className="setting-name">API documentation</div><div className="setting-description">OpenAPI JSON for workspace commands, Gmail, and scoped API keys.</div></div><a className="small-button" href={apiPath("/api/docs")} target="_blank" rel="noreferrer">Open docs <ArrowUpRight size={11} /></a></div>
        <div className="setting-row"><div><div className="setting-name">Portable data</div><div className="setting-description">Export the workspace JSON or permanently delete it with an explicit owner confirmation.</div></div><div className="row-actions"><a className="small-button" href={apiPath("/api/workspace/export")}>Export</a><button className="small-button" disabled={deleteBusy} onClick={() => void deleteWorkspace()}>{deleteBusy ? "Deleting…" : "Delete data"}</button></div></div>
      </section>
      <section className="panel">
        <PanelHeader title="Self-hosting status" caption="The boring stuff is the moat." />
        <div><div className="setting-row"><div><div className="setting-name">Storage adapter</div><div className="setting-description">Dell Postgres is required in production; the JSON fallback is local development only.</div></div><div className="code-value">{state.workspace.region.includes("Dell") ? "Postgres" : "local"}</div></div><div className="setting-row"><div><div className="setting-name">Model runtime</div><div className="setting-description">Production runs fail clearly when Ollama is unavailable.</div></div><div className="code-value">{state.workspace.model.includes("not configured") ? "blocked" : "Ollama"}</div></div><div className="setting-row"><div><div className="setting-name">Source code</div><div className="setting-description">Deploy the same container to the Dell or any Linux host.</div></div><div className="code-value">open</div></div></div>
      </section>
    </div>
  </>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>{children}</div></div>;
}

export default function PerpendicularConsole() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [runtimeHealthError, setRuntimeHealthError] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("overview");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("emp-atlas");
  const [chatInput, setChatInput] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHire, setShowHire] = useState(false);
  const [showDocument, setShowDocument] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [leadListId, setLeadListId] = useState<string | null>(null);
  const [showSequence, setShowSequence] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ name: "", title: "", department: "Growth", systemPrompt: "" });
  const [documentForm, setDocumentForm] = useState({ name: "", source: "upload", url: "", content: "" });
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [listForm, setListForm] = useState({ name: "", description: "" });
  const [leadForm, setLeadForm] = useState({ name: "", email: "", company: "", role: "", location: "" });
  const [sequenceForm, setSequenceForm] = useState({ name: "", audience: "", steps: [emptySequenceDraftStep()] });
  const [ticketForm, setTicketForm] = useState({ subject: "", message: "", priority: "normal", requesterEmail: "" });

  useEffect(() => {
    if (canonicalOrigin && window.location.hostname === "perpendicular-nine.vercel.app") {
      window.location.replace(`${canonicalOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    fetch(apiPath("/api/workspace"), { credentials: "include" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as WorkspaceState & { error?: string; loginUrl?: string; viewer?: Viewer };
        if (response.status === 401) {
          setLoginUrl(data.loginUrl || "/login");
          return null;
        }
        if (!response.ok) throw new Error(data.error || "Workspace failed to load.");
        setViewer(data.viewer || null);
        if (data.employees?.length) setSelectedEmployeeId((currentId) => data.employees.some((employee) => employee.id === currentId) ? currentId : data.employees[0].id);
        return data;
      })
        .then((nextState) => { if (nextState) setState(nextState); })
      .catch(() => setNotice("The workspace could not load. Start the app server and refresh."));
  }, []);

  useEffect(() => {
    fetch(apiPath("/api/usage?days=30"), { credentials: "include" })
      .then(async (response) => response.ok ? setUsage(await response.json() as UsageSummary) : undefined)
      .catch(() => undefined);
  }, [state?.runs.length, state?.workspace.aiCredits.remaining, state?.workspace.dataCredits.remaining]);

  useEffect(() => {
    let active = true;
    const refreshHealth = async () => {
      try {
        const response = await fetch(apiPath("/api/health"), { cache: "no-store" });
        const data = await response.json() as RuntimeHealth;
        if (!active) return;
        setRuntimeHealth(data);
        setRuntimeHealthError(!response.ok);
      } catch {
        if (!active) return;
        setRuntimeHealth(null);
        setRuntimeHealthError(true);
      }
    };
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 60000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const mutate: Mutation = async (action, payload = {}, success) => {
    setBusyAction(action);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const data = (await response.json()) as { state?: WorkspaceState; error?: string; loginUrl?: string; persisted?: boolean; workspace?: WorkspaceState["workspace"] };
      if (response.status === 401) {
        setLoginUrl(data.loginUrl || "/login");
        setState(null);
      }
      const nextState = data.state || (data.workspace ? data as WorkspaceState : null);
      if (nextState) {
        setState(nextState);
        if (nextState.employees.length && !nextState.employees.some((employee) => employee.id === selectedEmployeeId)) setSelectedEmployeeId(nextState.employees[0].id);
      }
      if (!nextState) throw new Error(data.error || "Action failed.");
      if (!response.ok && !data.persisted) throw new Error(data.error || "Action failed.");
      setNotice(data.error && data.persisted ? `Saved. ${data.error}` : success || "Saved.");
      return nextState;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const sendChat = () => {
    const message = chatInput.trim();
    if (!message || !selectedEmployeeId || busyAction === "chat") return;
    setChatInput("");
    void mutate("chat", { employeeId: selectedEmployeeId, message }, "Response grounded, scored, and added to the trace.");
  };

  const activeLabel = viewNames[activeView];
  const navigation = useMemo(() => navGroups.flatMap((group) => group.items), []);

  const submitEmployee = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate("create-employee", employeeForm, `${employeeForm.name || "New employee"} joined the team.`);
    if (!saved) return;
    setShowHire(false);
    setEmployeeForm({ name: "", title: "", department: "Growth", systemPrompt: "" });
  };

  const submitDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const payload: Record<string, unknown> = { ...documentForm };
      if (documentFile) {
        payload.fileName = documentFile.name;
        payload.fileType = documentFile.type;
        payload.fileData = await fileToBase64(documentFile);
      }
      const saved = await mutate("create-document", payload, `${documentForm.name || documentFile?.name || "The source"} is indexed and available to live employees.`);
      if (!saved) return;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The source could not be read.");
      return;
    }
    setShowDocument(false);
    setDocumentForm({ name: "", source: "upload", url: "", content: "" });
    setDocumentFile(null);
  };

  const submitList = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate("create-list", listForm, `${listForm.name} is ready for lead imports.`);
    if (!saved) return;
    setShowList(false);
    setListForm({ name: "", description: "" });
  };

  const submitLead = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate("import-row", { listId: leadListId || state?.lists[0]?.id, ...leadForm }, `${leadForm.name} was added to the list.`);
    if (!saved) return;
    setShowLead(false);
    setLeadListId(null);
    setLeadForm({ name: "", email: "", company: "", role: "", location: "" });
  };

  const submitSequence = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate("create-sequence", sequenceForm, `${sequenceForm.name} was created as a draft.`);
    if (!saved) return;
    setShowSequence(false);
    setSequenceForm({ name: "", audience: "", steps: [emptySequenceDraftStep()] });
  };

  const updateSequenceStep = (index: number, patch: Partial<SequenceDraftStep>) => {
    setSequenceForm((current) => ({
      ...current,
      steps: current.steps.map((step, candidate) => candidate === index ? { ...step, ...patch } : step),
    }));
  };

  const addSequenceStep = () => {
    setSequenceForm((current) => current.steps.length >= 5 ? current : {
      ...current,
      steps: [...current.steps, emptySequenceDraftStep(current.steps.length)],
    });
  };

  const removeSequenceStep = (index: number) => {
    setSequenceForm((current) => current.steps.length === 1 ? current : {
      ...current,
      steps: current.steps.filter((_, candidate) => candidate !== index),
    });
  };

  const submitTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await mutate("create-ticket", ticketForm, "Ticket opened with a priority-based SLA.");
    if (!saved) return;
    setShowTicket(false);
    setTicketForm({ subject: "", message: "", priority: "normal", requesterEmail: "" });
  };

  if (!state) {
    if (loginUrl) return <div className="loading"><div><h1>Sign in to Perpendicular</h1><p>Sign in to continue to your workspace.</p><a className="button-primary" href={loginUrl}>Sign in <ArrowUpRight size={13} /></a></div></div>;
    return <div className="loading">Loading the workspace…</div>;
  }

  if (state.workspace.onboarding.status !== "completed") return <><OnboardingView state={state} viewer={viewer} mutate={mutate} busyAction={busyAction} />{notice ? <div className="notice" role="alert">{notice}</div> : null}</>;

    return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" /><span>perpendicular<span className="brand-meta">open work system</span></span></div>
      <div className="nav-scroll">{navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; const count = navCount(item.id, state); return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={15} strokeWidth={1.8} /><span>{item.label}</span>{count !== null ? <span className="nav-count">{count}</span> : null}</button>; })}</div>)}</div>
      <div className="sidebar-footer"><RuntimeStatus health={runtimeHealth} error={runtimeHealthError} /><small>Ollama local runtime<br />Postgres persistence · LAN / Dell</small></div>
    </aside>
    <div className="main-shell">
      <div className="mobile-topbar">{navigation.map((item) => { const Icon = item.icon; return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={13} /><span>{item.label}</span></button>; })}</div>
      <header className="topbar"><div className="crumbs"><strong>{state.workspace.name}</strong><span className="slash">/</span><span>{activeLabel}</span></div><div className="top-actions">{busyAction ? <div className="action-status" role="status" aria-live="polite"><span className="action-spinner" />Working · {actionLabel(busyAction)}</div> : null}<RuntimeStatus health={runtimeHealth} error={runtimeHealthError} compact /><button className="command-button" onClick={() => { setActiveView("overview"); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus(), 0); }} disabled={Boolean(busyAction)}><Sparkles size={13} />Ask the system</button></div></header>
      <main className="content">{platformViewNames.has(activeView as PlatformViewName) ? <PlatformView view={activeView as PlatformViewName} state={state} mutate={mutate} /> : activeView === "overview" ? <Overview state={state} usage={usage} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} setView={setActiveView} chatInput={chatInput} setChatInput={setChatInput} chatBusy={busyAction === "chat"} onSend={sendChat} /> : activeView === "missions" ? <MissionsView state={state} mutate={mutate} busyAction={busyAction} /> : activeView === "employees" ? <EmployeesView state={state} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} mutate={mutate} setShowHire={setShowHire} /> : activeView === "knowledge" ? <KnowledgeView state={state} setShowDocument={setShowDocument} /> : activeView === "content" ? <ContentView state={state} mutate={mutate} /> : activeView === "lists" ? <ListsView state={state} mutate={mutate} setShowDocument={setShowDocument} setShowList={setShowList} setShowLead={(show, listId) => { setShowLead(show); if (listId) setLeadListId(listId); }} /> : activeView === "sequences" ? <SequencesView state={state} mutate={mutate} setShowSequence={setShowSequence} /> : activeView === "inbox" ? <InboxView state={state} mutate={mutate} setShowTicket={setShowTicket} /> : activeView === "playbooks" ? <PlaybooksView state={state} mutate={mutate} /> : activeView === "activity" ? <ActivityView state={state} /> : <SettingsView state={state} usage={usage} />}</main>
    </div>
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {showHire ? <Modal title="Hire an employee" description="A title is enough to start. The prompt is versioned from the first save." onClose={() => setShowHire(false)}><form className="form-card" onSubmit={submitEmployee}><div className="field"><label htmlFor="employee-name">Name</label><input id="employee-name" value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} placeholder="e.g. Atlas" /></div><div className="field"><label htmlFor="employee-title">Title *</label><input id="employee-title" required value={employeeForm.title} onChange={(event) => setEmployeeForm({ ...employeeForm, title: event.target.value })} placeholder="e.g. Revenue intelligence lead" /></div><div className="field"><label htmlFor="employee-department">Department</label><select id="employee-department" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option>Growth</option><option>Content</option><option>Support</option><option>Operations</option></select></div><div className="field"><label htmlFor="employee-prompt">System prompt</label><textarea id="employee-prompt" value={employeeForm.systemPrompt} onChange={(event) => setEmployeeForm({ ...employeeForm, systemPrompt: event.target.value })} placeholder="Optional. The system writes a safe default if blank." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowHire(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-employee"}>Create employee <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showDocument ? <Modal title="Add knowledge" description="Upload a PDF or text source, paste the facts, or let the Dell capture a public URL and index its readable text." onClose={() => setShowDocument(false)}><form className="form-card" onSubmit={submitDocument}><div className="field"><label htmlFor="document-name">Source name</label><input id="document-name" required value={documentForm.name} onChange={(event) => setDocumentForm({ ...documentForm, name: event.target.value })} placeholder="e.g. Sales playbook" /></div><div className="field"><label htmlFor="document-source">Source type</label><select id="document-source" value={documentForm.source} onChange={(event) => setDocumentForm({ ...documentForm, source: event.target.value })}><option value="upload">Upload / paste</option><option value="url">URL capture</option></select></div>{documentForm.source === "url" ? <div className="field"><label htmlFor="document-url">Public URL</label><input id="document-url" type="url" required value={documentForm.url} onChange={(event) => setDocumentForm({ ...documentForm, url: event.target.value })} placeholder="https://…" /></div> : <><div className="field"><label htmlFor="document-file">Upload a file</label><input id="document-file" type="file" accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json" onChange={(event) => setDocumentFile(event.target.files?.[0] || null)} /><small className="field-hint">PDF, TXT, Markdown, CSV, or JSON · max 8 MB</small></div><div className="field"><label htmlFor="document-content">Or paste content</label><textarea id="document-content" required={!documentFile} value={documentForm.content} onChange={(event) => setDocumentForm({ ...documentForm, content: event.target.value })} placeholder="The facts employees should be able to retrieve…" /></div></>}<div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowDocument(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-document"}>Index source <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showList ? <Modal title="Create a Smart List" description="A list is a durable workspace object. Add leads manually or import them through the API." onClose={() => setShowList(false)}><form className="form-card" onSubmit={submitList}><div className="field"><label htmlFor="list-name">List name</label><input id="list-name" required value={listForm.name} onChange={(event) => setListForm({ ...listForm, name: event.target.value })} placeholder="e.g. Product-led founders" /></div><div className="field"><label htmlFor="list-description">Description</label><textarea id="list-description" value={listForm.description} onChange={(event) => setListForm({ ...listForm, description: event.target.value })} placeholder="Who belongs in this list?" /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowList(false)}>Cancel</button><button type="submit" className="button-primary">Create list <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showLead ? <Modal title="Add a lead" description="Import only the fields you own. Public company research happens after the row is saved." onClose={() => setShowLead(false)}><form className="form-card" onSubmit={submitLead}><div className="field"><label htmlFor="lead-name">Full name</label><input id="lead-name" required value={leadForm.name} onChange={(event) => setLeadForm({ ...leadForm, name: event.target.value })} /></div><div className="field"><label htmlFor="lead-email">Business email</label><input id="lead-email" type="email" required value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} /></div><div className="field"><label htmlFor="lead-company">Company</label><input id="lead-company" required value={leadForm.company} onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })} /></div><div className="field"><label htmlFor="lead-role">Role</label><input id="lead-role" value={leadForm.role} onChange={(event) => setLeadForm({ ...leadForm, role: event.target.value })} /></div><div className="field"><label htmlFor="lead-location">Location</label><input id="lead-location" value={leadForm.location} onChange={(event) => setLeadForm({ ...leadForm, location: event.target.value })} /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowLead(false)}>Cancel</button><button type="submit" className="button-primary">Add lead <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showSequence ? <Modal title="Create a sequence" description="Build up to five steps. Email sends stay approval-gated; LinkedIn and Task steps remain visible manual work." onClose={() => setShowSequence(false)}><form className="form-card" onSubmit={submitSequence}><div className="field"><label htmlFor="sequence-name">Sequence name</label><input id="sequence-name" required value={sequenceForm.name} onChange={(event) => setSequenceForm({ ...sequenceForm, name: event.target.value })} placeholder="Founder follow-through" /></div><div className="field"><label htmlFor="sequence-audience">Audience</label><input id="sequence-audience" value={sequenceForm.audience} onChange={(event) => setSequenceForm({ ...sequenceForm, audience: event.target.value })} placeholder="Imported leads" /></div><div className="list-stack">{sequenceForm.steps.map((step, index) => <div className="detail-card" key={`sequence-step-${index}`}><div className="detail-card-header"><h3>Step {index + 1}</h3><div className="row-actions"><span>{step.channel}</span>{sequenceForm.steps.length > 1 ? <button type="button" className="small-button" onClick={() => removeSequenceStep(index)}>Remove</button> : null}</div></div><div className="detail-card-body"><div className="form-grid"><div className="field"><label htmlFor={`sequence-step-channel-${index}`}>Channel</label><select id={`sequence-step-channel-${index}`} value={step.channel} onChange={(event) => updateSequenceStep(index, { channel: event.target.value as SequenceDraftStep["channel"] })}><option value="Email">Email</option><option value="LinkedIn">LinkedIn</option><option value="Task">Task</option></select></div><div className="field"><label htmlFor={`sequence-step-delay-${index}`}>Timing</label><input id={`sequence-step-delay-${index}`} required value={step.delay} onChange={(event) => updateSequenceStep(index, { delay: event.target.value })} placeholder={index === 0 ? "Day 0" : "After 3 days"} /></div></div><div className="field"><label htmlFor={`sequence-step-title-${index}`}>Step name</label><input id={`sequence-step-title-${index}`} required value={step.title} onChange={(event) => updateSequenceStep(index, { title: event.target.value })} placeholder="Useful observation" /></div>{step.channel === "Email" ? <div className="field"><label htmlFor={`sequence-step-subject-${index}`}>Email subject</label><input id={`sequence-step-subject-${index}`} required value={step.subject} onChange={(event) => updateSequenceStep(index, { subject: event.target.value })} placeholder="A useful observation about {{companyName}}" /></div> : <div className="field-hint">Manual step — provider delivery is not claimed. Use this as the handoff for LinkedIn or human follow-up.</div>}<div className="field"><label htmlFor={`sequence-step-body-${index}`}>{step.channel === "Email" ? "Email draft" : "Instructions"}</label><textarea id={`sequence-step-body-${index}`} required value={step.body} onChange={(event) => updateSequenceStep(index, { body: event.target.value })} placeholder={step.channel === "Email" ? "Write a useful, specific touch." : "Describe the manual action and its success condition."} /></div></div></div>)}</div><button type="button" className="button-secondary" onClick={addSequenceStep} disabled={sequenceForm.steps.length >= 5}><Plus size={13} />{sequenceForm.steps.length >= 5 ? "Maximum of 5 steps" : "Add step"}</button><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowSequence(false)}>Cancel</button><button type="submit" className="button-primary">Create draft <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showTicket ? <Modal title="Open a ticket" description="Create a support item with an owner and a visible SLA clock. Add a requester email if this reply may be sent through Gmail later." onClose={() => setShowTicket(false)}><form className="form-card" onSubmit={submitTicket}><div className="field"><label htmlFor="ticket-subject">Subject</label><input id="ticket-subject" required value={ticketForm.subject} onChange={(event) => setTicketForm({ ...ticketForm, subject: event.target.value })} placeholder="What needs attention?" /></div><div className="field"><label htmlFor="ticket-requester-email">Requester email (optional)</label><input id="ticket-requester-email" type="email" value={ticketForm.requesterEmail} onChange={(event) => setTicketForm({ ...ticketForm, requesterEmail: event.target.value })} placeholder="customer@example.com" /></div><div className="field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={ticketForm.priority} onChange={(event) => setTicketForm({ ...ticketForm, priority: event.target.value })}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div><div className="field"><label htmlFor="ticket-message">Context</label><textarea id="ticket-message" required value={ticketForm.message} onChange={(event) => setTicketForm({ ...ticketForm, message: event.target.value })} placeholder="Give the employee or human owner enough context to act." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowTicket(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-ticket"}>Open ticket <ArrowUpRight size={13} /></button></div></form></Modal> : null}
  </div>;
}
