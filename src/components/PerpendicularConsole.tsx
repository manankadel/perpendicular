"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  CalendarClock,
  Check,
  ChevronRight,
  Database,
  FileText,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  Plus,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { Activity as ActivityRecord, Employee, OnboardingGoal, SmartList, SmartRow, UsageSummary, WorkspaceState } from "@/lib/domain";
import type { DeadLetterJob } from "@/lib/job-store";
import type { WebhookEventSummary } from "@/lib/integration-store";

type View = "overview" | "employees" | "knowledge" | "lists" | "sequences" | "inbox" | "activity" | "settings";
type Mutation = (action: string, payload?: Record<string, unknown>, success?: string) => Promise<void>;
type Viewer = { email: string; firstName: string; lastName: string };
type OpsSummary = { webhooks: WebhookEventSummary[]; deadLetterJobs: DeadLetterJob[] };

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
const apiPath = (path: string) => `${apiBase}${path}`;

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || fallback;
}

const navGroups: { label: string; items: { id: View; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Workbench", icon: LayoutDashboard },
      { id: "employees", label: "Employees", icon: Bot },
      { id: "knowledge", label: "Knowledge", icon: BrainCircuit },
      { id: "lists", label: "Smart Lists", icon: ListChecks },
      { id: "sequences", label: "Sequences", icon: Send },
      { id: "inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "System",
    items: [
      { id: "activity", label: "Activity", icon: Activity },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const viewNames: Record<View, string> = {
  overview: "Workbench",
  employees: "Employees",
  knowledge: "Knowledge",
  lists: "Smart Lists",
  sequences: "Sequences",
  inbox: "Inbox",
  activity: "Activity",
  settings: "Settings",
};

function navCount(view: View, state: WorkspaceState) {
  if (view === "employees") return state.employees.length;
  if (view === "knowledge") return state.documents.length;
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

function EmployeeDetail({ employee, mutate }: { employee: Employee; mutate: Mutation }) {
  const [task, setTask] = useState(employee.schedule?.task || "Review this week's pipeline and write the highest-leverage next action.");
  const currentVersion = employee.promptVersions.find((version) => version.active);
  const [selectedVersionId, setSelectedVersionId] = useState(currentVersion?.id || employee.promptVersions[0]?.id || "");
  const selectedVersion = employee.promptVersions.find((version) => version.id === selectedVersionId) || currentVersion;
  const scoreDelta = selectedVersion?.goldenScore != null && currentVersion?.goldenScore != null
    ? selectedVersion.goldenScore - currentVersion.goldenScore
    : null;
  return <div className="employee-detail"><section className="panel profile-strip"><div className="profile-main"><div className="employee-avatar">{employee.avatar}</div><div><div className="profile-name">{employee.name}</div><div className="profile-title">{employee.title} · {employee.department} · {employee.memoryScope}-scoped memory</div></div></div><div className="profile-score"><div><div className="score-label">Quality score</div><div className="profile-score-number">{employee.score || "—"}</div></div><Sparkline values={employee.scoreTrend} large /></div></section>
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
  const completedRuns = state.runs.filter((run) => run.status === "completed").length;
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const dailyAiBurn = usage && usage.aiUnits > 0 ? usage.aiUnits / 30 : 0;
  const thresholdRemaining = state.workspace.aiCredits.limit * 0.1;
  const forecastDays = dailyAiBurn > 0 && state.workspace.aiCredits.remaining > thresholdRemaining
    ? Math.ceil((state.workspace.aiCredits.remaining - thresholdRemaining) / dailyAiBurn)
    : null;
  const forecastNote = usage ? (forecastDays ? `90% threshold in about ${forecastDays}d at current burn` : "At or below the 90% threshold") : "No 30-day burn recorded";
  return <><PageHeading eyebrow={dateLabel} title="Make the work visible." subtitle="Perpendicular keeps employees, context, and follow-through in one loop. Every autonomous action leaves behind a score, a trace, and a next move."><button className="button-secondary" onClick={() => setView("activity")}><Activity size={13} />View activity</button><button className="button-primary" onClick={() => setView("employees")}><Plus size={13} />Hire an employee</button></PageHeading>
    <div className="metric-grid"><MetricCard label="AI Credits" value={`${state.workspace.aiCredits.remaining}`} note={`${state.workspace.aiCredits.limit - state.workspace.aiCredits.remaining} used · ${forecastNote}`} tone={state.workspace.aiCredits.remaining < state.workspace.aiCredits.limit * 0.1 ? "warn" : ""} /><MetricCard label="Data Credits" value={`${state.workspace.dataCredits.remaining}`} note={`${state.workspace.dataCredits.purchased - state.workspace.dataCredits.remaining} used · public research only`} tone="good" /><MetricCard label="Work completed" value={`${completedRuns}`} note={`${state.runs.length} persisted run${state.runs.length === 1 ? "" : "s"} in workspace`} tone="good" /><MetricCard label="Needs attention" value={`${openTickets}`} note={breachedTickets ? `${breachedTickets} SLA breach${breachedTickets === 1 ? "" : "es"}` : "No SLA breaches"} tone={breachedTickets ? "warn" : "good"} /></div>
    <div className="workbench-grid"><div><section className="panel"><PanelHeader title="Autonomous work" caption="The latest work, not a notification feed."><button className="button-quiet" onClick={() => setView("activity")}>Open log <ChevronRight size={13} /></button></PanelHeader><div className="run-list">{latestRuns.map((run) => { const employee = state.employees.find((item) => item.id === run.employeeId); return <div className="run-row" key={run.id}><div className="run-avatar">{employee?.avatar || "AI"}</div><div><div className="run-title">{employee?.name || "Employee"} · {run.task}</div><div className="run-detail">{run.reason}</div><div className="run-trigger"><Radio size={11} />{run.trigger} · {relativeTime(run.createdAt)} · {run.durationMs}ms</div></div><div className="run-score">{run.score}</div></div>; })}</div></section><div className="section-block"><div className="section-kicker"><h2>People doing the work</h2><span>{state.employees.length} employees · {state.employees.filter((employee) => employee.schedule?.enabled).length} autonomous</span></div><div className="employee-grid">{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selectedEmployeeId} onSelect={() => { setSelectedEmployeeId(employee.id); setView("employees"); }} key={employee.id} />)}</div></div></div><ChatPanel state={state} employeeId={selectedEmployeeId} setEmployeeId={setSelectedEmployeeId} input={chatInput} setInput={setChatInput} onSend={onSend} busy={chatBusy} /></div>
  </>;
}

function EmployeesView({ state, selectedEmployeeId, setSelectedEmployeeId, mutate, setShowHire }: { state: WorkspaceState; selectedEmployeeId: string; setSelectedEmployeeId: (id: string) => void; mutate: Mutation; setShowHire: (show: boolean) => void }) {
  const selected = state.employees.find((employee) => employee.id === selectedEmployeeId) || state.employees[0];
  return <><PageHeading eyebrow="The core primitive" title="Employees, not chats." subtitle="Named roles with memory, knowledge, tools, schedules, and a quality score that improves in public."><button className="button-primary" onClick={() => setShowHire(true)}><Plus size={13} />Hire employee</button></PageHeading><div className="employee-grid section-block" style={{ marginTop: 0 }}>{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selected?.id} onSelect={() => setSelectedEmployeeId(employee.id)} key={employee.id} />)}</div>{selected ? <div className="section-block"><EmployeeDetail key={selected.id} employee={selected} mutate={mutate} /></div> : <div className="empty-state">Hire the first employee to open the workbench.</div>}</>;
}

function KnowledgeView({ state, setShowDocument }: { state: WorkspaceState; setShowDocument: (show: boolean) => void }) {
  return <><PageHeading eyebrow="Ground truth" title="Knowledge that stays attached." subtitle="Give employees the context they need, scoped to the company. Every answer shows what it used—and when it had to fall back."><button className="button-primary" onClick={() => setShowDocument(true)}><Plus size={13} />Add knowledge</button></PageHeading><div className="subpage-grid"><section className="panel"><PanelHeader title="Workspace sources" caption={`${state.documents.length} sources · ${state.documents.reduce((total, document) => total + document.chunks, 0)} indexed chunks`} /> <div className="list-stack">{state.documents.map((document) => <div className="list-item" key={document.id}><div className="list-main"><div className="list-title"><span className="source-tag">{document.source}</span>{document.name}</div><div className="list-desc">{document.content}</div><div className="list-meta">{document.chunks} chunks · shared with {document.employeeIds.length} employee{document.employeeIds.length === 1 ? "" : "s"} · updated {relativeTime(document.updatedAt)}</div></div><StatusPill status={document.status === "ready" ? "enriched" : "pending"} /></div>)}</div></section><div className="list-stack"><section className="panel form-card"><h3>Retrieval contract</h3><p>Simple local retrieval is live in this build. Swap the adapter for Qdrant embeddings on the Dell without changing the employee contract.</p><div className="setting-row"><div><div className="setting-name">Scoped by company</div><div className="setting-description">No cross-tenant reads.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">Citations on answers</div><div className="setting-description">Source names travel with the message.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">No source match</div><div className="setting-description">Fallback is explicitly labeled.</div></div><Check size={15} color="var(--mint)" /></div></section><section className="panel form-card"><h3>What happens next</h3><p>Upload a PDF, paste a URL, or add a playbook. New sources are shared with live employees by default and can later be narrowed field-by-field.</p><button className="button-secondary" onClick={() => setShowDocument(true)}><FileText size={13} />Add a source</button></section></div></div></>;
}

function ListsView({ state, mutate: providedMutate, setShowList, setShowLead }: { state: WorkspaceState; mutate?: Mutation; setShowList: (show: boolean) => void; setShowLead: (show: boolean) => void; setShowDocument?: (show: boolean) => void }) {
  const list = state.lists[0];
  const [actionError, setActionError] = useState<string | null>(null);
  const mutate: Mutation = providedMutate || (async (action, payload = {}) => {
    setActionError(null);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      if (!response.ok) throw new Error(await responseError(response, "Action failed. Refresh and try again."));
      window.location.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed. Refresh and try again.");
    }
  });
  const [filter, setFilter] = useState("");
  const filteredRows = list?.rows.filter((row) => `${row.name} ${row.company} ${row.role}`.toLowerCase().includes(filter.toLowerCase())) || [];
  return <><PageHeading eyebrow="Rows that do work" title="Smart Lists are workflows." subtitle="Import people, research public company evidence, and enroll only qualified rows. Perpendicular never labels an email verified without a real verification provider."><button className="button-secondary" onClick={() => setShowList(true)}><Plus size={13} />Create list</button><button className="button-primary" disabled={!list} onClick={() => setShowLead(true)}><Plus size={13} />Add lead</button></PageHeading>{actionError ? <div className="notice" role="alert">{actionError}</div> : null}{list ? <div className="panel"><PanelHeader title={list.name} caption={`${list.rows.length} rows · ${list.rows.filter((row) => row.status === "enriched").length} researched`}><div className="server-status"><span className="status-dot" />Public evidence only</div></PanelHeader><div className="list-toolbar"><div className="toolbar-search"><SearchIcon /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search rows…" aria-label="Search smart list rows" /></div><div className="credit-preview"><Database size={13} />Research estimate: <strong>{filteredRows.length * 2} Data Credits</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role / location</th><th>ICP score</th><th>Signal</th><th>Sequence</th><th>Actions</th></tr></thead><tbody>{filteredRows.map((row) => <SmartRowItem key={row.id} row={row} list={list} state={state} mutate={mutate} />)}</tbody></table>{!filteredRows.length ? <div className="empty-state">Add a lead to start this list.</div> : null}</div></div> : <div className="empty-state">Create a list, then add a lead or import one through the API.</div>}</>;
}

function SearchIcon() { return <span className="search-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>; }

function SmartRowItem({ row, list, state, mutate }: { row: SmartRow; list: SmartList; state: WorkspaceState; mutate: Mutation }) {
  const sequence = state.sequences.find((item) => item.status === "live");
  const suppressed = state.suppressedEmails.includes(row.email.toLowerCase());
  return <tr><td><div className="row-name"><div className="row-initial">{initials(row.name)}</div><div><strong>{row.name}</strong><div className="row-company">{row.company} · {row.email}</div></div></div></td><td><strong>{row.role}</strong><div className="row-company">{row.location}</div></td><td className="score-cell">{row.score}</td><td><div>{row.intent}</div><div className={`row-company ${row.emailStatus === "verified" ? "verified" : "unknown"}`}>{row.emailStatus === "verified" ? "Verified email" : "Needs enrichment"}</div></td><td><span className={suppressed ? "unknown" : row.enrollmentStatus === "enrolled" ? "verified" : "unknown"}>{suppressed ? "suppressed" : row.enrollmentStatus}</span></td><td><div className="row-actions">{suppressed ? <button className="small-button" onClick={() => void mutate("unsuppress-row", { listId: list.id, rowId: row.id }, `${row.name} can be enrolled again.`)}>Unsuppress</button> : <button className="small-button" onClick={() => void mutate("suppress-row", { listId: list.id, rowId: row.id }, `${row.name} suppressed for this workspace.`)}>Suppress</button>}{row.status === "enriched" ? <span className="small-button ready"><Check size={11} />Ready</span> : <button className="small-button" onClick={() => void mutate("enrich-row", { listId: list.id, rowId: row.id }, `${row.name} enriched. 2 Data Credits used.`)}><Zap size={11} />Enrich</button>}{suppressed || row.enrollmentStatus === "enrolled" || !sequence ? <span className="small-button">{suppressed ? "Blocked" : row.enrollmentStatus === "enrolled" ? "In sequence" : "No live seq"}</span> : <button className="small-button" onClick={() => void mutate("enroll-row", { listId: list.id, rowId: row.id, sequenceId: sequence.id }, `${row.name} enrolled with reply-pause enabled.`)}><Send size={11} />Enroll</button>}</div></td></tr>;
}

function SequencesView({ state, mutate, setShowSequence }: { state: WorkspaceState; mutate: Mutation; setShowSequence: (show: boolean) => void }) {
  const list = state.lists[0];
  return <><PageHeading eyebrow="One list, one send" title="Follow-through with guardrails." subtitle="A sequence is a controlled rhythm—not a blast. Gmail, reply-pause, suppression, and human approval are part of the send path."><button className="button-primary" onClick={() => setShowSequence(true)}><Plus size={13} />Create sequence</button><button className="button-secondary" disabled={!list || !state.sequences.length} onClick={() => void mutate("enroll-row", { listId: list?.id, rowId: list?.rows.find((row) => row.enrollmentStatus !== "enrolled")?.id, sequenceId: state.sequences[0]?.id }, "The next researched row entered the sequence.")}><Send size={13} />Enroll next researched row</button></PageHeading>{state.sequences.length ? <div className="sequence-list">{state.sequences.map((sequence) => <section className="sequence-card" key={sequence.id}><div className="sequence-head"><div><div className="sequence-name">{sequence.name} <StatusPill status={sequence.status === "live" ? "live" : "draft"} /></div><div className="sequence-audience">Audience · {sequence.audience}</div></div><div className="sequence-metrics"><div className="sequence-metric"><strong>{sequence.enrolled}</strong><span>Enrolled</span></div><div className="sequence-metric"><strong>{sequence.replied}</strong><span>Replies</span></div><div className="sequence-metric"><strong>{sequence.booked}</strong><span>Booked</span></div></div></div><div className="steps">{sequence.steps.map((step, index) => <div className="step" key={step.id}><div className="step-number">{index + 1}</div><div className="step-channel">{step.channel}</div><div><div className="step-title">{step.title}</div><div className="step-body">{step.body}</div></div><div className="step-delay">{step.delay}</div></div>)}</div>{sequence.status === "live" ? <div className="sequence-footer"><span className="list-meta">Suppression · reply-pause · timezone windows · audit log</span></div> : <div className="sequence-footer"><span className="list-meta">Draft · connect Gmail and review every send before activation</span></div>}</section>)}</div> : <div className="empty-state">Create a draft sequence, then connect Gmail before any external send is enabled.</div>}</>;
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
  return <><PageHeading eyebrow="Support that is a system" title="Tickets and conversations, not vague handoffs." subtitle="Every escalation has an ID, an owner, an SLA clock, and a customer rating. Gmail replies are persisted here and pause matching sequence enrollments."><button className="button-primary" onClick={() => setShowTicket(true)}><Plus size={13} />Open ticket</button></PageHeading><section className="panel"><PanelHeader title="Gmail inbox" caption={`${messages.length} persisted message${messages.length === 1 ? "" : "s"} · sync from Settings`}><span className="server-status"><Mail size={13} color="var(--mint)" />Workspace-scoped</span></PanelHeader>{inboxError ? <div className="empty-state">{inboxError}</div> : messages.length ? <div className="mail-list">{messages.map((message) => <article className="mail-row" key={message.id}><div className="mail-direction"><Mail size={14} /><span>{message.direction}</span></div><div className="mail-main"><div className="mail-subject">{message.subject || "(no subject)"}</div><div className="mail-meta">{message.sender} · {relativeTime(message.receivedAt)} · thread {message.providerThreadId}</div><p>{message.bodyText}</p></div></article>)}</div> : <div className="empty-state">No Gmail messages have been synced yet. Connect Gmail and run Sync inbox from Settings.</div>}</section><section className="panel"><PanelHeader title="Support queue" caption={`${state.tickets.filter((ticket) => ticket.status !== "resolved").length} active · SLA timers running`}><span className="server-status"><Timer size={13} color="var(--signal)" />SLA-aware</span></PanelHeader><div className="ticket-list">{state.tickets.map((ticket) => <div className="ticket" key={ticket.id}><div><div className="ticket-id">{ticket.id}</div><span className={`ticket-priority ${ticket.priority}`}>{ticket.priority}</span></div><div><div className="ticket-subject">{ticket.subject}</div><div className="ticket-message">{ticket.message}</div><div className="ticket-sla">{ticket.status === "resolved" ? "Resolved" : isPast(ticket.slaDueAt) ? "SLA breached · needs escalation" : `SLA due ${relativeTime(ticket.slaDueAt).replace("ago", "from now")}`} · owner {ticket.assignee}</div></div><div className="row-actions">{ticket.status !== "resolved" ? <button className="small-button" onClick={() => void mutate("resolve-ticket", { ticketId: ticket.id }, `${ticket.id} resolved with the trace attached.`)}><Check size={11} />Resolve</button> : ticket.csat ? <span className="small-button ready">CSAT {ticket.csat}/5</span> : <button className="small-button" onClick={() => void mutate("rate-ticket", { ticketId: ticket.id, rating: 5 }, `${ticket.id} received a 5/5 CSAT.`)}>Rate 5/5</button>}</div></div>)}</div></section></>;
}

function ActivityView({ state }: { state: WorkspaceState }) {
  return <><PageHeading eyebrow="Proof of work" title="Everything leaves a trace." subtitle="Autonomy only earns trust when you can inspect what happened, why it happened, and what it cost."><span className="server-status"><ShieldCheck size={13} color="var(--mint)" />Company-scoped audit log</span></PageHeading><section className="panel"><PanelHeader title="Activity log" caption={`${state.activity.length} recent events · newest first`} /><div className="activity-list">{state.activity.map((item) => <div className="activity-row" key={item.id}><div className="activity-icon"><ActivityGlyph type={item.type} /></div><div><div className="activity-title">{item.title}</div><div className="activity-detail">{item.detail}</div></div><div className="activity-time">{relativeTime(item.createdAt)}</div></div>)}</div></section></>;
}

function OnboardingView({ state, viewer, mutate, busyAction }: { state: WorkspaceState; viewer: Viewer | null; mutate: Mutation; busyAction: string | null }) {
  const onboarding = state.workspace.onboarding;
  const [goal, setGoal] = useState<OnboardingGoal>(onboarding.goal || "revenue");
  const inferredUrl = viewer?.email.split("@")[1] && !["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"].includes(viewer.email.split("@")[1].toLowerCase())
    ? `https://${viewer.email.split("@")[1].toLowerCase()}`
    : "";
  const [companyUrl, setCompanyUrl] = useState(onboarding.companyUrl || inferredUrl);
  const [companyDescription, setCompanyDescription] = useState("");
  const goalOptions: Array<{ id: OnboardingGoal; label: string; detail: string }> = [
    { id: "revenue", label: "Find more revenue", detail: "Prioritize pipeline, positioning, and next moves." },
    { id: "delivery", label: "Run delivery better", detail: "Turn active work into clear owners and deadlines." },
    { id: "content", label: "Ship better content", detail: "Build a grounded content rhythm from your real voice." },
    { id: "support", label: "Protect customer experience", detail: "Spot support risks and make the next response obvious." },
  ];
  const discovering = busyAction === "bootstrap-workspace";
  const briefing = busyAction === "run-onboarding-brief";
  const scheduling = busyAction === "enable-onboarding-schedule";
  const operator = onboarding.employeeId ? state.employees.find((employee) => employee.id === onboarding.employeeId) : null;
  const firstRun = onboarding.runId ? state.runs.find((run) => run.id === onboarding.runId) : null;
  const source = onboarding.documentId ? state.documents.find((document) => document.id === onboarding.documentId) : null;
  const gmail = state.integrations?.find((integration) => integration.provider === "gmail");

  if (onboarding.status === "not_started") {
    return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">Perpendicular setup</div><h1 className="page-title">Let the system learn the work.</h1><p className="page-subtitle">Give Perpendicular one real source and a priority. It will build the first operator, ground it in your context, and prove the loop before asking you to automate anything.</p><div className="onboarding-steps"><div className="onboarding-step active"><span>01</span><div><strong>Discover</strong><small>Read your real context</small></div></div><div className="onboarding-step"><span>02</span><div><strong>Prove</strong><small>Run a grounded brief</small></div></div><div className="onboarding-step"><span>03</span><div><strong>Repeat</strong><small>Turn on the daily rhythm</small></div></div></div></div><section className="onboarding-card"><div className="onboarding-card-heading"><div><div className="eyebrow">One source. One operator. One proof.</div><h2>What should Perpendicular own first?</h2></div><span className="onboarding-badge">No fake data</span></div><div className="goal-grid">{goalOptions.map((option) => <button className={`goal-option ${goal === option.id ? "selected" : ""}`} onClick={() => setGoal(option.id)} key={option.id}><span className="goal-radio" /> <span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</div><div className="field"><label htmlFor="onboarding-url">Public company URL</label><input id="onboarding-url" type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} placeholder="https://yourcompany.com" /><small className="field-hint">We inspect only this public page. No credentials or private mailbox data is read.</small></div><div className="field"><label htmlFor="onboarding-description">If you do not have a public site, describe the work</label><textarea id="onboarding-description" value={companyDescription} onChange={(event) => setCompanyDescription(event.target.value)} placeholder="Optional fallback: what your team sells, who it serves, and what is currently stuck." /></div><button className="button-primary onboarding-submit" disabled={discovering || (!companyUrl.trim() && companyDescription.trim().length < 40)} onClick={() => void mutate("bootstrap-workspace", { goal, companyUrl: companyUrl.trim(), companyDescription: companyDescription.trim() }, "Workspace discovered. Your first operator is ready.")}>{discovering ? "Reading your workspace…" : "Discover and build my operator"}<ArrowUpRight size={13} /></button><p className="onboarding-footnote">This creates one real knowledge source and one real employee in your Dell-backed workspace. It does not invent leads, send email, or enable automation.</p></section></div>;
  }

  if (onboarding.status === "ready") {
    return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">Discovery complete</div><h1 className="page-title">Your first operator is ready.</h1><p className="page-subtitle">The source below was fetched and persisted on the Dell. Review the scope, then run the first brief through your local model.</p><div className="onboarding-steps"><div className="onboarding-step complete"><span>✓</span><div><strong>Discover</strong><small>Source indexed</small></div></div><div className="onboarding-step active"><span>02</span><div><strong>Prove</strong><small>Run a grounded brief</small></div></div><div className="onboarding-step"><span>03</span><div><strong>Repeat</strong><small>Turn on the daily rhythm</small></div></div></div></div><section className="onboarding-card"><div className="discovery-summary"><div className="discovery-icon">{operator?.avatar || "AI"}</div><div><div className="eyebrow">{operator?.department || "Operations"} operator</div><h2>{operator?.name || "Your operator"} · {operator?.title || "Workspace operator"}</h2><p>{operator?.systemPrompt}</p></div></div><div className="discovery-facts"><div><span>Source</span><strong>{source?.name || onboarding.sourceTitle || "Indexed workspace source"}</strong><small>{source?.chunks || 0} chunks · {source?.source === "url" ? "public URL" : "operator brief"}</small></div><div><span>Goal</span><strong>{goalOptions.find((option) => option.id === onboarding.goal)?.label || "Workspace priorities"}</strong><small>Scoped to this company only</small></div><div><span>Connection</span><strong>{gmail?.status === "connected" ? "Gmail connected" : "Gmail stays off"}</strong><small>{gmail?.status === "connected" ? gmail.accountEmail || "OAuth mailbox" : "Connect later in Settings"}</small></div></div><div className="onboarding-action-row"><button className="button-primary" disabled={briefing} onClick={() => void mutate("run-onboarding-brief", {}, "First brief completed and scored.")}>{briefing ? "Running the local operator…" : "Run my first brief"}<Zap size={13} /></button></div><p className="onboarding-footnote">The brief is the proof step. If Ollama is unavailable, Perpendicular will stop and tell you instead of showing a made-up result.</p></section></div>;
  }

  return <div className="onboarding-shell"><div className="onboarding-intro"><div className="eyebrow">First proof complete</div><h1 className="page-title">Now make it repeat.</h1><p className="page-subtitle">{operator?.name || "Your operator"} produced a persisted run with a score and trace. Keep it manual, or let the Dell wake it once a day.</p><div className="onboarding-steps"><div className="onboarding-step complete"><span>✓</span><div><strong>Discover</strong><small>Source indexed</small></div></div><div className="onboarding-step complete"><span>✓</span><div><strong>Prove</strong><small>Run scored</small></div></div><div className={`onboarding-step ${onboarding.scheduleEnabled ? "complete" : "active"}`}><span>{onboarding.scheduleEnabled ? "✓" : "03"}</span><div><strong>Repeat</strong><small>{onboarding.scheduleEnabled ? "Daily rhythm on" : "Optional daily rhythm"}</small></div></div></div></div><section className="onboarding-card"><div className="run-proof"><div className="run-proof-head"><div><div className="eyebrow">Persisted run · {firstRun?.trigger || "manual"}</div><h2>{firstRun?.task || "First workspace brief"}</h2></div><div className="proof-score">{firstRun?.score ?? "—"}<small>score</small></div></div><div className="run-proof-output">{firstRun?.output || "The run completed, but its output could not be loaded."}</div><div className="trace-strip">{(firstRun?.trace || []).map((step) => <span key={step.label}><Check size={11} />{step.label}<small>{step.durationMs}ms · {step.cost} credit</small></span>)}</div></div><div className="onboarding-action-row"><button className="button-primary" disabled={scheduling || onboarding.scheduleEnabled} onClick={() => void mutate("enable-onboarding-schedule", {}, "Daily rhythm enabled on the Dell heartbeat.")}>{scheduling ? "Enabling rhythm…" : onboarding.scheduleEnabled ? "Daily rhythm enabled" : "Keep this running daily"}<CalendarClock size={13} /></button></div><p className="onboarding-footnote">You can change or pause the schedule from Employees. Gmail remains approval-gated until you explicitly connect and test it.</p></section></div>;
}

function SettingsView({ state, usage }: { state: WorkspaceState; usage: UsageSummary | null }) {
  const gmail = state.integrations?.find((integration) => integration.provider === "gmail");
  const [testRecipient, setTestRecipient] = useState("");
  const [gmailBusy, setGmailBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  useEffect(() => {
    fetch(apiPath("/api/ops"), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Operations data could not be loaded."));
        setOps(await response.json() as OpsSummary);
      })
      .catch((error: unknown) => setSettingsMessage(error instanceof Error ? error.message : "Operations data could not be loaded."));
  }, []);
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
  return <><PageHeading eyebrow="Operator controls" title="Open by default." subtitle="No paid model API is required to run this workspace. The runtime is designed for the Dell, with Postgres persistence and Ollama as the local worker."><span className="status-pill live"><span className="status-dot" />{state.workspace.plan}</span></PageHeading>{settingsMessage ? <div className="notice" role="alert">{settingsMessage}</div> : null}<div className="settings-grid"><section className="panel"><PanelHeader title="Workspace contract" caption={`Company boundary: ${state.workspace.id}`} /><div><div className="setting-row"><div><div className="setting-name">Runtime region</div><div className="setting-description">Where the app and data are expected to live.</div></div><div className="setting-value">{state.workspace.region}</div></div><div className="setting-row"><div><div className="setting-name">Worker model</div><div className="setting-description">Swap with any Ollama-compatible open model.</div></div><div className="setting-value">{state.workspace.model}</div></div><div className="setting-row"><div><div className="setting-name">AI credits</div><div className="setting-description">Local worker budget for chat and scheduled actions.</div></div><div className="setting-value">{state.workspace.aiCredits.remaining} / {state.workspace.aiCredits.limit}</div></div><div className="setting-row"><div><div className="setting-name">Data credits</div><div className="setting-description">Local budget for public company research.</div></div><div className="setting-value">{state.workspace.dataCredits.remaining}</div></div></div></section><section className="panel"><PanelHeader title="Usage ledger" caption="Persisted credit burn for the last 30 days." /><div className="setting-row"><div><div className="setting-name">AI usage</div><div className="setting-description">Chat, runs, evaluations, and heartbeat work.</div></div><div className="setting-value">{usage ? usage.aiUnits : "Unavailable"}</div></div><div className="setting-row"><div><div className="setting-name">Data usage</div><div className="setting-description">Public research actions only.</div></div><div className="setting-value">{usage ? usage.dataUnits : "Unavailable"}</div></div>{usage?.byFeature.length ? <div className="health-log">{usage.byFeature.slice(0, 8).map((entry) => <div className="list-meta" key={entry.feature}>{entry.feature} · {entry.units} units</div>)}</div> : <div className="list-meta">Usage appears after db/004_usage_ledger.sql is applied and a real action runs.</div>}</section><section className="panel"><PanelHeader title="Operations" caption="Workspace-scoped webhooks and dead-letter work." /><div className="setting-row"><div><div className="setting-name">Webhook events</div><div className="setting-description">Provider events are persisted before processing and can be replayed after a failure.</div></div><div className="setting-value">{ops?.webhooks.length ?? "—"}</div></div>{ops?.webhooks.slice(0, 5).map((event) => <div className="setting-row" key={event.id}><div><div className="setting-name">{event.provider} · {event.eventType}</div><div className="setting-description">{event.error || `${event.status} · ${relativeTime(event.createdAt)}`}</div></div><div className="row-actions">{event.status === "failed" || event.status === "processed" ? <button className="small-button" disabled={opsBusy === `replay-webhook:${event.id}`} onClick={() => void operate("replay-webhook", event.id)}>{opsBusy === `replay-webhook:${event.id}` ? "Replaying…" : "Replay"}</button> : <span className="small-button">{event.status}</span>}</div></div>)}<div className="setting-row"><div><div className="setting-name">Dead-letter jobs</div><div className="setting-description">Failed heartbeat jobs can be requeued without editing the database.</div></div><div className="setting-value">{ops?.deadLetterJobs.length ?? "—"}</div></div>{ops?.deadLetterJobs.slice(0, 5).map((job) => <div className="setting-row" key={job.id}><div><div className="setting-name">{job.kind}</div><div className="setting-description">{job.lastError || `${job.attempts}/${job.maxAttempts} attempts`}</div></div><button className="small-button" disabled={opsBusy === `retry-job:${job.id}`} onClick={() => void operate("retry-job", job.id)}>{opsBusy === `retry-job:${job.id}` ? "Retrying…" : "Retry"}</button></div>)}{!ops ? <div className="list-meta">Operations data is unavailable until the platform migrations are applied.</div> : null}</section><section className="panel"><PanelHeader title="Connections" caption="Credentials are kept on the Dell and never returned to the browser." /><div className="setting-row"><div><div className="setting-name"><Mail size={14} /> Gmail</div><div className="setting-description">OAuth mailbox for explicit tests, inbox sync, and approved sequence sends.</div>{gmail?.accountEmail ? <div className="list-meta">{gmail.accountEmail} · {gmail.lastSyncAt ? `synced ${relativeTime(gmail.lastSyncAt)}` : "not synced yet"}</div> : null}</div>{gmail?.status === "connected" ? <div className="row-actions"><button className="small-button" disabled={gmailBusy} onClick={() => void syncGmail()}>Sync inbox</button><button className="small-button" disabled={gmailBusy} onClick={() => void renewGmailWatch()}>Renew watch</button><button className="small-button" disabled={gmailBusy} onClick={() => void disconnectGmail()}>Disconnect</button></div> : gmail?.status === "not_configured" ? <div className="list-meta">Gmail OAuth is not configured on the Dell.</div> : <a className="button-secondary" href={apiPath("/api/integrations/google/start")}><Mail size={13} />Connect Gmail</a>}</div>{gmail?.status === "connected" ? <div className="form-actions"><input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} placeholder="your test address" aria-label="Test email recipient" /><button className="button-secondary" disabled={gmailBusy || !testRecipient} onClick={() => void sendTest()}>Send test email</button></div> : null}{gmail?.health?.length ? <div className="health-log">{gmail.health.slice(0, 5).map((event) => <div className="list-meta" key={`${event.createdAt}-${event.eventType}`}>{event.status} · {event.eventType} · {event.detail} · {relativeTime(event.createdAt)}</div>)}</div> : null}<div className="setting-row"><div><div className="setting-name">API documentation</div><div className="setting-description">OpenAPI JSON for workspace commands, Gmail, and scoped API keys.</div></div><a className="small-button" href={apiPath("/api/docs")} target="_blank" rel="noreferrer">Open docs <ArrowUpRight size={11} /></a></div><div className="setting-row"><div><div className="setting-name">Portable data</div><div className="setting-description">Export the workspace JSON or permanently delete it with an explicit owner confirmation.</div></div><div className="row-actions"><a className="small-button" href={apiPath("/api/workspace/export")}>Export</a><button className="small-button" disabled={deleteBusy} onClick={() => void deleteWorkspace()}>{deleteBusy ? "Deleting…" : "Delete data"}</button></div></div></section><section className="panel"><PanelHeader title="Self-hosting status" caption="The boring stuff is the moat." /><div><div className="setting-row"><div><div className="setting-name">Storage adapter</div><div className="setting-description">Dell Postgres is required in production; the JSON fallback is local development only.</div></div><div className="code-value">{state.workspace.region.includes("Dell") ? "Postgres" : "local"}</div></div><div className="setting-row"><div><div className="setting-name">Model runtime</div><div className="setting-description">Production runs fail clearly when Ollama is unavailable.</div></div><div className="code-value">{state.workspace.model.includes("not configured") ? "blocked" : "Ollama"}</div></div><div className="setting-row"><div><div className="setting-name">Source code</div><div className="setting-description">Deploy the same container to the Dell or any Linux host.</div></div><div className="code-value">open</div></div></div></section></div></>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>{children}</div></div>;
}

export default function PerpendicularConsole() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
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
  const [showSequence, setShowSequence] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ name: "", title: "", department: "Growth", systemPrompt: "" });
  const [documentForm, setDocumentForm] = useState({ name: "", source: "upload", url: "", content: "" });
  const [listForm, setListForm] = useState({ name: "", description: "" });
  const [leadForm, setLeadForm] = useState({ name: "", email: "", company: "", role: "", location: "" });
  const [sequenceForm, setSequenceForm] = useState({ name: "", audience: "", body: "" });
  const [ticketForm, setTicketForm] = useState({ subject: "", message: "", priority: "normal" });

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
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const mutate: Mutation = async (action, payload = {}, success) => {
    setBusyAction(action);
    try {
      const response = await fetch(apiPath("/api/workspace"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const data = (await response.json()) as { state?: WorkspaceState; error?: string; loginUrl?: string; workspace?: WorkspaceState["workspace"] };
      if (response.status === 401) {
        setLoginUrl(data.loginUrl || "/login");
        setState(null);
      }
      const nextState = data.state || (data.workspace ? data as WorkspaceState : null);
      if (nextState) {
        setState(nextState);
        if (nextState.employees.length && !nextState.employees.some((employee) => employee.id === selectedEmployeeId)) setSelectedEmployeeId(nextState.employees[0].id);
      }
      if (!response.ok || !nextState) throw new Error(data.error || "Action failed.");
      setNotice(success || "Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
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

  const submitEmployee = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-employee", employeeForm, `${employeeForm.name || "New employee"} joined the team.`);
    setShowHire(false);
    setEmployeeForm({ name: "", title: "", department: "Growth", systemPrompt: "" });
  };

  const submitDocument = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-document", documentForm, `${documentForm.name} is indexed and available to live employees.`);
    setShowDocument(false);
    setDocumentForm({ name: "", source: "upload", url: "", content: "" });
  };

  const submitList = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-list", listForm, `${listForm.name} is ready for lead imports.`);
    setShowList(false);
    setListForm({ name: "", description: "" });
  };

  const submitLead = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("import-row", { listId: state?.lists[0]?.id, ...leadForm }, `${leadForm.name} was added to the list.`);
    setShowLead(false);
    setLeadForm({ name: "", email: "", company: "", role: "", location: "" });
  };

  const submitSequence = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-sequence", sequenceForm, `${sequenceForm.name} was created as a draft.`);
    setShowSequence(false);
    setSequenceForm({ name: "", audience: "", body: "" });
  };

  const submitTicket = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-ticket", ticketForm, "Ticket opened with a priority-based SLA.");
    setShowTicket(false);
    setTicketForm({ subject: "", message: "", priority: "normal" });
  };

  if (!state) {
    if (loginUrl) return <div className="loading"><div><h1>Sign in to Perpendicular</h1><p>Sign in to continue to your workspace.</p><a className="button-primary" href={loginUrl}>Sign in <ArrowUpRight size={13} /></a></div></div>;
    return <div className="loading">Loading the workspace…</div>;
  }

  if (state.workspace.onboarding.status !== "completed") return <><OnboardingView state={state} viewer={viewer} mutate={mutate} busyAction={busyAction} />{notice ? <div className="notice" role="alert">{notice}</div> : null}</>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark" /><span>perpendicular<span className="brand-meta">open work system</span></span></div><div className="nav-scroll">{navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; const count = navCount(item.id, state); return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={15} strokeWidth={1.8} /><span>{item.label}</span>{count !== null ? <span className="nav-count">{count}</span> : null}</button>; })}</div>)}</div><div className="sidebar-footer"><div className="server-chip"><span className="status-dot" />Dell node healthy</div><small>Ollama local runtime<br />Postgres persistence · LAN / Dell</small></div></aside><div className="main-shell"><div className="mobile-topbar">{navigation.map((item) => { const Icon = item.icon; return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={13} /><span>{item.label}</span></button>; })}</div><header className="topbar"><div className="crumbs"><strong>{state.workspace.name}</strong><span className="slash">/</span><span>{activeLabel}</span></div><div className="top-actions"><div className="server-status"><span className="status-dot" />Self-hosted · online</div><button className="command-button" onClick={() => { setActiveView("overview"); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus(), 0); }}><Sparkles size={13} />Ask the system</button></div></header><main className="content">{activeView === "overview" ? <Overview state={state} usage={usage} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} setView={setActiveView} chatInput={chatInput} setChatInput={setChatInput} chatBusy={busyAction === "chat"} onSend={sendChat} /> : activeView === "employees" ? <EmployeesView state={state} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} mutate={mutate} setShowHire={setShowHire} /> : activeView === "knowledge" ? <KnowledgeView state={state} setShowDocument={setShowDocument} /> : activeView === "lists" ? <ListsView state={state} setShowDocument={setShowDocument} setShowList={setShowList} setShowLead={setShowLead} /> : activeView === "sequences" ? <SequencesView state={state} mutate={mutate} setShowSequence={setShowSequence} /> : activeView === "inbox" ? <InboxView state={state} mutate={mutate} setShowTicket={setShowTicket} /> : activeView === "activity" ? <ActivityView state={state} /> : <SettingsView state={state} usage={usage} />}</main></div>{notice ? <div className="notice" role="status">{notice}</div> : null}
    {showHire ? <Modal title="Hire an employee" description="A title is enough to start. The prompt is versioned from the first save." onClose={() => setShowHire(false)}><form className="form-card" onSubmit={submitEmployee}><div className="field"><label htmlFor="employee-name">Name</label><input id="employee-name" value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} placeholder="e.g. Atlas" /></div><div className="field"><label htmlFor="employee-title">Title *</label><input id="employee-title" required value={employeeForm.title} onChange={(event) => setEmployeeForm({ ...employeeForm, title: event.target.value })} placeholder="e.g. Revenue intelligence lead" /></div><div className="field"><label htmlFor="employee-department">Department</label><select id="employee-department" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option>Growth</option><option>Content</option><option>Support</option><option>Operations</option></select></div><div className="field"><label htmlFor="employee-prompt">System prompt</label><textarea id="employee-prompt" value={employeeForm.systemPrompt} onChange={(event) => setEmployeeForm({ ...employeeForm, systemPrompt: event.target.value })} placeholder="Optional. The system writes a safe default if blank." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowHire(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-employee"}>Create employee <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showDocument ? <Modal title="Add knowledge" description="Paste a source or let the Dell capture a public URL and index its readable text." onClose={() => setShowDocument(false)}><form className="form-card" onSubmit={submitDocument}><div className="field"><label htmlFor="document-name">Source name</label><input id="document-name" required value={documentForm.name} onChange={(event) => setDocumentForm({ ...documentForm, name: event.target.value })} placeholder="e.g. Sales playbook" /></div><div className="field"><label htmlFor="document-source">Source type</label><select id="document-source" value={documentForm.source} onChange={(event) => setDocumentForm({ ...documentForm, source: event.target.value })}><option value="upload">Upload / paste</option><option value="url">URL capture</option></select></div>{documentForm.source === "url" ? <div className="field"><label htmlFor="document-url">Public URL</label><input id="document-url" type="url" required value={documentForm.url} onChange={(event) => setDocumentForm({ ...documentForm, url: event.target.value })} placeholder="https://…" /></div> : <div className="field"><label htmlFor="document-content">Content</label><textarea id="document-content" required value={documentForm.content} onChange={(event) => setDocumentForm({ ...documentForm, content: event.target.value })} placeholder="The facts employees should be able to retrieve…" /></div>}<div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowDocument(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-document"}>Index source <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showList ? <Modal title="Create a Smart List" description="A list is a durable workspace object. Add leads manually or import them through the API." onClose={() => setShowList(false)}><form className="form-card" onSubmit={submitList}><div className="field"><label htmlFor="list-name">List name</label><input id="list-name" required value={listForm.name} onChange={(event) => setListForm({ ...listForm, name: event.target.value })} placeholder="e.g. Product-led founders" /></div><div className="field"><label htmlFor="list-description">Description</label><textarea id="list-description" value={listForm.description} onChange={(event) => setListForm({ ...listForm, description: event.target.value })} placeholder="Who belongs in this list?" /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowList(false)}>Cancel</button><button type="submit" className="button-primary">Create list <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showLead ? <Modal title="Add a lead" description="Import only the fields you own. Public company research happens after the row is saved." onClose={() => setShowLead(false)}><form className="form-card" onSubmit={submitLead}><div className="field"><label htmlFor="lead-name">Full name</label><input id="lead-name" required value={leadForm.name} onChange={(event) => setLeadForm({ ...leadForm, name: event.target.value })} /></div><div className="field"><label htmlFor="lead-email">Business email</label><input id="lead-email" type="email" required value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} /></div><div className="field"><label htmlFor="lead-company">Company</label><input id="lead-company" required value={leadForm.company} onChange={(event) => setLeadForm({ ...leadForm, company: event.target.value })} /></div><div className="field"><label htmlFor="lead-role">Role</label><input id="lead-role" value={leadForm.role} onChange={(event) => setLeadForm({ ...leadForm, role: event.target.value })} /></div><div className="field"><label htmlFor="lead-location">Location</label><input id="lead-location" value={leadForm.location} onChange={(event) => setLeadForm({ ...leadForm, location: event.target.value })} /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowLead(false)}>Cancel</button><button type="submit" className="button-primary">Add lead <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showSequence ? <Modal title="Create a sequence" description="New sequences are drafts. Gmail connection, suppression checks, and human approval are required before sending." onClose={() => setShowSequence(false)}><form className="form-card" onSubmit={submitSequence}><div className="field"><label htmlFor="sequence-name">Sequence name</label><input id="sequence-name" required value={sequenceForm.name} onChange={(event) => setSequenceForm({ ...sequenceForm, name: event.target.value })} /></div><div className="field"><label htmlFor="sequence-audience">Audience</label><input id="sequence-audience" value={sequenceForm.audience} onChange={(event) => setSequenceForm({ ...sequenceForm, audience: event.target.value })} placeholder="Imported leads" /></div><div className="field"><label htmlFor="sequence-body">First email draft</label><textarea id="sequence-body" required value={sequenceForm.body} onChange={(event) => setSequenceForm({ ...sequenceForm, body: event.target.value })} placeholder="Write a useful, specific first touch." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowSequence(false)}>Cancel</button><button type="submit" className="button-primary">Create draft <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showTicket ? <Modal title="Open a ticket" description="Create a support item with an owner and a visible SLA clock." onClose={() => setShowTicket(false)}><form className="form-card" onSubmit={submitTicket}><div className="field"><label htmlFor="ticket-subject">Subject</label><input id="ticket-subject" required value={ticketForm.subject} onChange={(event) => setTicketForm({ ...ticketForm, subject: event.target.value })} placeholder="What needs attention?" /></div><div className="field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={ticketForm.priority} onChange={(event) => setTicketForm({ ...ticketForm, priority: event.target.value })}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div><div className="field"><label htmlFor="ticket-message">Context</label><textarea id="ticket-message" required value={ticketForm.message} onChange={(event) => setTicketForm({ ...ticketForm, message: event.target.value })} placeholder="Give the employee or human owner enough context to act." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowTicket(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-ticket"}>Open ticket <ArrowUpRight size={13} /></button></div></form></Modal> : null}
  </div>;
}
