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
import type { Activity as ActivityRecord, Employee, SmartList, SmartRow, WorkspaceState } from "@/lib/domain";

type View = "overview" | "employees" | "knowledge" | "lists" | "sequences" | "inbox" | "activity" | "settings";
type Mutation = (action: string, payload?: Record<string, unknown>, success?: string) => Promise<void>;

const navGroups: { label: string; items: { id: View; label: string; icon: LucideIcon; count?: string }[] }[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Workbench", icon: LayoutDashboard },
      { id: "employees", label: "Employees", icon: Bot, count: "3" },
      { id: "knowledge", label: "Knowledge", icon: BrainCircuit, count: "3" },
      { id: "lists", label: "Smart Lists", icon: ListChecks, count: "1" },
      { id: "sequences", label: "Sequences", icon: Send, count: "2" },
      { id: "inbox", label: "Inbox", icon: Inbox, count: "2" },
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
  return <section className="panel chat-panel"><div className="panel-header"><div className="chat-meta"><div className="employee-avatar">{employee?.avatar || "AI"}</div><div className="chat-employee"><select value={employee?.id} onChange={(event) => setEmployeeId(event.target.value)} aria-label="Choose an employee">{state.employees.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.title}</option>)}</select><div className="panel-caption">Knowledge-grounded · {employee?.model}</div></div></div><MessageSquare size={16} color="var(--text-dim)" /></div>
    <div className="chat-messages">{conversation?.messages.length ? conversation.messages.map((message) => <div className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === "assistant" ? employee?.name : "You"}</div><div className="message-body">{message.content}</div>{message.citations?.length ? <div className="citations">{message.citations.map((citation) => <span className="citation" key={citation}>{citation}</span>)}</div> : null}</div>) : <div className="chat-empty"><div><Sparkles size={18} /><br />Ask an employee to turn a messy question into a next action.</div></div>}</div>
    <div className="chat-compose"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder={`Ask ${employee?.name || "an employee"}…`} aria-label="Message an employee" /><button className="button-primary" onClick={onSend} disabled={busy || !input.trim()}>{busy ? "…" : "Send"}<ArrowUpRight size={13} /></button></div>
  </section>;
}

function EmployeeDetail({ employee, mutate }: { employee: Employee; mutate: Mutation }) {
  const [task, setTask] = useState(employee.schedule?.task || "Review this week's pipeline and write the highest-leverage next action.");
  const currentVersion = employee.promptVersions.find((version) => version.active);
  return <div className="employee-detail"><section className="panel profile-strip"><div className="profile-main"><div className="employee-avatar">{employee.avatar}</div><div><div className="profile-name">{employee.name}</div><div className="profile-title">{employee.title} · {employee.department} · {employee.memoryScope}-scoped memory</div></div></div><div className="profile-score"><div><div className="score-label">Quality score</div><div className="profile-score-number">{employee.score || "—"}</div></div><Sparkline values={employee.scoreTrend} large /></div></section>
    <div className="detail-grid"><div className="detail-card"><div className="detail-card-header"><h3>Identity contract</h3><span>Prompt v{currentVersion?.version || 1}</span></div><div className="detail-card-body"><div className="prompt-box">{employee.systemPrompt}</div><div className="prompt-note"><ShieldCheck size={14} /> Changes are versioned. Nothing silently overwrites the live prompt.</div><div className="form-actions"><button className="button-secondary" onClick={() => void mutate("evaluate-employee", { employeeId: employee.id }, `${employee.name} evaluated against the golden set.`)}><Gauge size={13} />Run golden eval</button></div></div></div>
      <div className="detail-card"><div className="detail-card-header"><h3>Heartbeat</h3><span>{employee.schedule?.enabled ? "Autonomous" : "Manual only"}</span></div><div className="detail-card-body"><div className="field"><label htmlFor="heartbeat-task">Task to repeat</label><textarea id="heartbeat-task" value={task} onChange={(event) => setTask(event.target.value)} /></div><div className="field"><label htmlFor="heartbeat-cadence">Cadence</label><select id="heartbeat-cadence" defaultValue={employee.schedule?.cadence || "daily"}><option>every 15m</option><option>hourly</option><option>daily</option><option>weekly</option></select></div><button className="button-primary" onClick={() => void mutate("schedule-employee", { employeeId: employee.id, enabled: true, cadence: (document.getElementById("heartbeat-cadence") as HTMLSelectElement)?.value, task }, `${employee.name} will wake up on schedule.`)}><CalendarClock size={13} />Save schedule</button>{employee.schedule?.nextRunAt ? <div className="list-meta">Next wake-up {relativeTime(employee.schedule.nextRunAt)}</div> : null}</div></div>
    </div>
    <div className="detail-grid"><div className="detail-card"><div className="detail-card-header"><h3>Prompt versions</h3><span>{employee.promptVersions.length} recorded</span></div><div className="detail-card-body"><div className="version-list">{employee.promptVersions.slice(0, 4).map((version) => <div className="version-row" key={version.id}><div className="version-number">v{version.version}</div><div><div className="version-note">{version.note}</div><div className="version-author">{version.author} · {relativeTime(version.createdAt)}</div></div>{version.active ? <div className="active-tag">Live</div> : <div className="list-meta">Review</div>}</div>)}</div></div></div>
      <div className="detail-card"><div className="detail-card-header"><h3>Golden set</h3><span>{employee.goldenTests.length} cases · drift protected</span></div><div className="detail-card-body"><div className="golden-list">{employee.goldenTests.map((test) => <div className="golden-row" key={test.id}><div><div className="golden-input">{test.input}</div><div className="golden-expected">Expecting: {test.expected}</div></div><div className="golden-score">{test.lastScore || "—"}</div></div>)}</div></div></div>
    </div>
    <div className="detail-card"><PanelHeader title="Run a real task" caption="The same worker path used by a heartbeat." /><div className="form-card"><div className="field"><label htmlFor="real-task">Task</label><textarea id="real-task" value={task} onChange={(event) => setTask(event.target.value)} /></div><button className="button-primary" onClick={() => void mutate("run-employee", { employeeId: employee.id, task }, `${employee.name} completed the task and received a score.`)}><Zap size={13} />Run now</button></div></div>
  </div>;
}

function Overview({ state, selectedEmployeeId, setSelectedEmployeeId, setView, chatInput, setChatInput, chatBusy, onSend }: { state: WorkspaceState; selectedEmployeeId: string; setSelectedEmployeeId: (id: string) => void; setView: (view: View) => void; chatInput: string; setChatInput: (value: string) => void; chatBusy: boolean; onSend: () => void }) {
  const latestRuns = state.runs.slice(0, 4);
  const openTickets = state.tickets.filter((ticket) => ticket.status !== "resolved").length;
  return <><PageHeading eyebrow="Friday · 04 September 2026" title="Make the work visible." subtitle="Perpendicular keeps employees, context, and follow-through in one loop. Every autonomous action leaves behind a score, a trace, and a next move."><button className="button-secondary" onClick={() => setView("activity")}><Activity size={13} />View activity</button><button className="button-primary" onClick={() => setView("employees")}><Plus size={13} />Hire an employee</button></PageHeading>
    <div className="metric-grid"><MetricCard label="AI Credits" value={`${state.workspace.aiCredits.remaining}`} note={`${state.workspace.aiCredits.limit - state.workspace.aiCredits.remaining} used · forecast hits 90% in 18d`} tone="warn" /><MetricCard label="Data Credits" value={`${state.workspace.dataCredits.remaining}`} note="Never expire · 2 per matched lookup" tone="good" /><MetricCard label="Work completed" value={`${state.runs.filter((run) => run.status === "completed").length}`} note="+4 runs since yesterday" tone="good" /><MetricCard label="Needs attention" value={`${openTickets}`} note="1 SLA already breached" tone="warn" /></div>
    <div className="workbench-grid"><div><section className="panel"><PanelHeader title="Autonomous work" caption="The latest work, not a notification feed."><button className="button-quiet" onClick={() => setView("activity")}>Open log <ChevronRight size={13} /></button></PanelHeader><div className="run-list">{latestRuns.map((run) => { const employee = state.employees.find((item) => item.id === run.employeeId); return <div className="run-row" key={run.id}><div className="run-avatar">{employee?.avatar || "AI"}</div><div><div className="run-title">{employee?.name || "Employee"} · {run.task}</div><div className="run-detail">{run.reason}</div><div className="run-trigger"><Radio size={11} />{run.trigger} · {relativeTime(run.createdAt)} · {run.durationMs}ms</div></div><div className="run-score">{run.score}</div></div>; })}</div></section><div className="section-block"><div className="section-kicker"><h2>People doing the work</h2><span>{state.employees.length} employees · {state.employees.filter((employee) => employee.schedule?.enabled).length} autonomous</span></div><div className="employee-grid">{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selectedEmployeeId} onSelect={() => { setSelectedEmployeeId(employee.id); setView("employees"); }} key={employee.id} />)}</div></div></div><ChatPanel state={state} employeeId={selectedEmployeeId} setEmployeeId={setSelectedEmployeeId} input={chatInput} setInput={setChatInput} onSend={onSend} busy={chatBusy} /></div>
  </>;
}

function EmployeesView({ state, selectedEmployeeId, setSelectedEmployeeId, mutate, setShowHire }: { state: WorkspaceState; selectedEmployeeId: string; setSelectedEmployeeId: (id: string) => void; mutate: Mutation; setShowHire: (show: boolean) => void }) {
  const selected = state.employees.find((employee) => employee.id === selectedEmployeeId) || state.employees[0];
  return <><PageHeading eyebrow="The core primitive" title="Employees, not chats." subtitle="Named roles with memory, knowledge, tools, schedules, and a quality score that improves in public."><button className="button-primary" onClick={() => setShowHire(true)}><Plus size={13} />Hire employee</button></PageHeading><div className="employee-grid section-block" style={{ marginTop: 0 }}>{state.employees.map((employee) => <EmployeeCard employee={employee} selected={employee.id === selected?.id} onSelect={() => setSelectedEmployeeId(employee.id)} key={employee.id} />)}</div>{selected ? <div className="section-block"><EmployeeDetail employee={selected} mutate={mutate} /></div> : <div className="empty-state">Hire the first employee to open the workbench.</div>}</>;
}

function KnowledgeView({ state, setShowDocument }: { state: WorkspaceState; setShowDocument: (show: boolean) => void }) {
  return <><PageHeading eyebrow="Ground truth" title="Knowledge that stays attached." subtitle="Give employees the context they need, scoped to the company. Every answer shows what it used—and when it had to fall back."><button className="button-primary" onClick={() => setShowDocument(true)}><Plus size={13} />Add knowledge</button></PageHeading><div className="subpage-grid"><section className="panel"><PanelHeader title="Workspace sources" caption={`${state.documents.length} sources · ${state.documents.reduce((total, document) => total + document.chunks, 0)} indexed chunks`} /> <div className="list-stack">{state.documents.map((document) => <div className="list-item" key={document.id}><div className="list-main"><div className="list-title"><span className="source-tag">{document.source}</span>{document.name}</div><div className="list-desc">{document.content}</div><div className="list-meta">{document.chunks} chunks · shared with {document.employeeIds.length} employee{document.employeeIds.length === 1 ? "" : "s"} · updated {relativeTime(document.updatedAt)}</div></div><StatusPill status={document.status === "ready" ? "enriched" : "pending"} /></div>)}</div></section><div className="list-stack"><section className="panel form-card"><h3>Retrieval contract</h3><p>Simple local retrieval is live in this build. Swap the adapter for Qdrant embeddings on the Dell without changing the employee contract.</p><div className="setting-row"><div><div className="setting-name">Scoped by company</div><div className="setting-description">No cross-tenant reads.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">Citations on answers</div><div className="setting-description">Source names travel with the message.</div></div><Check size={15} color="var(--mint)" /></div><div className="setting-row"><div><div className="setting-name">No source match</div><div className="setting-description">Fallback is explicitly labeled.</div></div><Check size={15} color="var(--mint)" /></div></section><section className="panel form-card"><h3>What happens next</h3><p>Upload a PDF, paste a URL, or add a playbook. New sources are shared with live employees by default and can later be narrowed field-by-field.</p><button className="button-secondary" onClick={() => setShowDocument(true)}><FileText size={13} />Add a source</button></section></div></div></>;
}

function ListsView({ state, mutate }: { state: WorkspaceState; mutate: Mutation }) {
  const list = state.lists[0];
  const [filter, setFilter] = useState("");
  const filteredRows = list?.rows.filter((row) => `${row.name} ${row.company} ${row.role}`.toLowerCase().includes(filter.toLowerCase())) || [];
  return <><PageHeading eyebrow="Rows that do work" title="Smart Lists are workflows." subtitle="Enrich, qualify, and enroll from the same row. Before a bulk action runs, Perpendicular shows the credit cost and respects suppression state."><button className="button-secondary" onClick={() => void mutate("enrich-row", { listId: list?.id, rowId: filteredRows[0]?.id }, "Preview row enriched. Only qualified rows should enter a send.")}><Gauge size={13} />Preview 2-credit action</button></PageHeading><div className="panel"><PanelHeader title={list?.name || "Smart List"} caption={`${list?.rows.length || 0} rows · ${list?.rows.filter((row) => row.status === "enriched").length || 0} enriched · updated just now`}><div className="server-status"><span className="status-dot" />No suppression conflicts</div></PanelHeader><div className="list-toolbar"><div className="toolbar-search"><SearchIcon /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search rows…" aria-label="Search smart list rows" /></div><div className="credit-preview"><Database size={13} />Bulk estimate: <strong>{filteredRows.length * 2} Data Credits</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role / location</th><th>ICP score</th><th>Signal</th><th>Sequence</th><th>Actions</th></tr></thead><tbody>{filteredRows.map((row) => <SmartRowItem key={row.id} row={row} list={list} state={state} mutate={mutate} />)}</tbody></table></div></div></>;
}

function SearchIcon() { return <span className="search-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>; }

function SmartRowItem({ row, list, state, mutate }: { row: SmartRow; list: SmartList; state: WorkspaceState; mutate: Mutation }) {
  const sequence = state.sequences.find((item) => item.status === "live");
  return <tr><td><div className="row-name"><div className="row-initial">{initials(row.name)}</div><div><strong>{row.name}</strong><div className="row-company">{row.company} · {row.email}</div></div></div></td><td><strong>{row.role}</strong><div className="row-company">{row.location}</div></td><td className="score-cell">{row.score}</td><td><div>{row.intent}</div><div className={`row-company ${row.emailStatus === "verified" ? "verified" : "unknown"}`}>{row.emailStatus === "verified" ? "Verified email" : "Needs enrichment"}</div></td><td><span className={row.enrollmentStatus === "enrolled" ? "verified" : "unknown"}>{row.enrollmentStatus}</span></td><td><div className="row-actions">{row.status === "enriched" ? <span className="small-button ready"><Check size={11} />Ready</span> : <button className="small-button" onClick={() => void mutate("enrich-row", { listId: list.id, rowId: row.id }, `${row.name} enriched. 2 Data Credits used.`)}><Zap size={11} />Enrich</button>}{row.enrollmentStatus === "enrolled" || !sequence ? <span className="small-button">{row.enrollmentStatus === "enrolled" ? "In sequence" : "No live seq"}</span> : <button className="small-button" onClick={() => void mutate("enroll-row", { listId: list.id, rowId: row.id, sequenceId: sequence.id }, `${row.name} enrolled with reply-pause enabled.`)}><Send size={11} />Enroll</button>}</div></td></tr>;
}

function SequencesView({ state, mutate }: { state: WorkspaceState; mutate: Mutation }) {
  const list = state.lists[0];
  return <><PageHeading eyebrow="One list, one send" title="Follow-through with guardrails." subtitle="A sequence is a controlled rhythm—not a blast. Reply-pause, verified addresses, and the audit trail are part of the send path."><button className="button-secondary" onClick={() => void mutate("enroll-row", { listId: list?.id, rowId: list?.rows.find((row) => row.enrollmentStatus !== "enrolled")?.id, sequenceId: state.sequences[0]?.id }, "The next qualified row entered the sequence.")}><Send size={13} />Enroll next qualified row</button></PageHeading><div className="sequence-list">{state.sequences.map((sequence) => <section className="sequence-card" key={sequence.id}><div className="sequence-head"><div><div className="sequence-name">{sequence.name} <StatusPill status={sequence.status === "live" ? "live" : "draft"} /></div><div className="sequence-audience">Audience · {sequence.audience}</div></div><div className="sequence-metrics"><div className="sequence-metric"><strong>{sequence.enrolled}</strong><span>Enrolled</span></div><div className="sequence-metric"><strong>{sequence.replied}</strong><span>Replies</span></div><div className="sequence-metric"><strong>{sequence.booked}</strong><span>Booked</span></div></div></div><div className="steps">{sequence.steps.map((step, index) => <div className="step" key={step.id}><div className="step-number">{index + 1}</div><div className="step-channel">{step.channel}</div><div><div className="step-title">{step.title}</div><div className="step-body">{step.body}</div></div><div className="step-delay">{step.delay}</div></div>)}</div>{sequence.status === "live" ? <div className="sequence-footer"><span className="list-meta">Suppression · reply-pause · timezone windows · audit log</span></div> : null}</section>)}</div></>;
}

function InboxView({ state, mutate, setShowTicket }: { state: WorkspaceState; mutate: Mutation; setShowTicket: (show: boolean) => void }) {
  return <><PageHeading eyebrow="Support that is a system" title="Tickets, not vague handoffs." subtitle="Every escalation has an ID, an owner, an SLA clock, and a customer rating. A chatbot without this is just another tab to monitor."><button className="button-primary" onClick={() => setShowTicket(true)}><Plus size={13} />Open ticket</button></PageHeading><section className="panel"><PanelHeader title="Support queue" caption={`${state.tickets.filter((ticket) => ticket.status !== "resolved").length} active · SLA timers running`}><span className="server-status"><Timer size={13} color="var(--signal)" />SLA-aware</span></PanelHeader><div className="ticket-list">{state.tickets.map((ticket) => <div className="ticket" key={ticket.id}><div><div className="ticket-id">{ticket.id}</div><span className={`ticket-priority ${ticket.priority}`}>{ticket.priority}</span></div><div><div className="ticket-subject">{ticket.subject}</div><div className="ticket-message">{ticket.message}</div><div className="ticket-sla">{ticket.status === "resolved" ? "Resolved" : isPast(ticket.slaDueAt) ? "SLA breached · needs escalation" : `SLA due ${relativeTime(ticket.slaDueAt).replace("ago", "from now")}`} · owner {ticket.assignee}</div></div><div className="row-actions">{ticket.status !== "resolved" ? <button className="small-button" onClick={() => void mutate("resolve-ticket", { ticketId: ticket.id }, `${ticket.id} resolved with the trace attached.`)}><Check size={11} />Resolve</button> : ticket.csat ? <span className="small-button ready">CSAT {ticket.csat}/5</span> : <button className="small-button" onClick={() => void mutate("rate-ticket", { ticketId: ticket.id, rating: 5 }, `${ticket.id} received a 5/5 CSAT.`)}>Rate 5/5</button>}</div></div>)}</div></section></>;
}

function ActivityView({ state }: { state: WorkspaceState }) {
  return <><PageHeading eyebrow="Proof of work" title="Everything leaves a trace." subtitle="Autonomy only earns trust when you can inspect what happened, why it happened, and what it cost."><span className="server-status"><ShieldCheck size={13} color="var(--mint)" />Company-scoped audit log</span></PageHeading><section className="panel"><PanelHeader title="Activity log" caption={`${state.activity.length} recent events · newest first`} /><div className="activity-list">{state.activity.map((item) => <div className="activity-row" key={item.id}><div className="activity-icon"><ActivityGlyph type={item.type} /></div><div><div className="activity-title">{item.title}</div><div className="activity-detail">{item.detail}</div></div><div className="activity-time">{relativeTime(item.createdAt)}</div></div>)}</div></section></>;
}

function SettingsView({ state }: { state: WorkspaceState }) {
  return <><PageHeading eyebrow="Operator controls" title="Open by default." subtitle="No paid model API is required to run this workspace. The runtime is designed for the Dell, with Postgres persistence and Ollama as the local worker."><span className="status-pill live"><span className="status-dot" />{state.workspace.plan}</span></PageHeading><div className="settings-grid"><section className="panel"><PanelHeader title="Workspace contract" caption={`Company boundary: ${state.workspace.id}`} /><div><div className="setting-row"><div><div className="setting-name">Runtime region</div><div className="setting-description">Where the app and data are expected to live.</div></div><div className="setting-value">{state.workspace.region}</div></div><div className="setting-row"><div><div className="setting-name">Worker model</div><div className="setting-description">Swap with any Ollama-compatible open model.</div></div><div className="setting-value">{state.workspace.model}</div></div><div className="setting-row"><div><div className="setting-name">AI credits</div><div className="setting-description">Monthly pool for chat and worker actions.</div></div><div className="setting-value">{state.workspace.aiCredits.remaining} / {state.workspace.aiCredits.limit}</div></div><div className="setting-row"><div><div className="setting-name">Data credits</div><div className="setting-description">Never-expiring pool for matched enrichment.</div></div><div className="setting-value">{state.workspace.dataCredits.remaining}</div></div></div></section><section className="panel"><PanelHeader title="Self-hosting status" caption="The boring stuff is the moat." /><div><div className="setting-row"><div><div className="setting-name">Storage adapter</div><div className="setting-description">Postgres when DATABASE_URL is present; atomic JSON fallback locally.</div></div><div className="code-value">ready</div></div><div className="setting-row"><div><div className="setting-name">Model fallback</div><div className="setting-description">Offline responses stay labeled instead of failing silently.</div></div><div className="code-value">active</div></div><div className="setting-row"><div><div className="setting-name">External calls</div><div className="setting-description">No Stripe, data vendor, or hosted AI dependency in this build.</div></div><div className="code-value">0 required</div></div><div className="setting-row"><div><div className="setting-name">Source code</div><div className="setting-description">Deploy the same container to the Dell or any Linux host.</div></div><div className="code-value">open</div></div></div></section></div></>;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>{children}</div></div>;
}

export default function PerpendicularConsole() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [activeView, setActiveView] = useState<View>("overview");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("emp-atlas");
  const [chatInput, setChatInput] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHire, setShowHire] = useState(false);
  const [showDocument, setShowDocument] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ name: "", title: "", department: "Growth", systemPrompt: "" });
  const [documentForm, setDocumentForm] = useState({ name: "", source: "upload", content: "" });
  const [ticketForm, setTicketForm] = useState({ subject: "", message: "", priority: "normal" });

  useEffect(() => {
    fetch("/api/workspace", { headers: { "x-company-id": "blueblood-demo" } })
      .then(async (response) => { if (!response.ok) throw new Error("Workspace failed to load."); return response.json() as Promise<WorkspaceState>; })
      .then((nextState) => setState(nextState))
      .catch(() => setNotice("The workspace could not load. Start the app server and refresh."));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const mutate: Mutation = async (action, payload = {}, success) => {
    setBusyAction(action);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json", "x-company-id": "blueblood-demo" }, body: JSON.stringify({ action, ...payload }) });
      const data = (await response.json()) as { state?: WorkspaceState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error || "Action failed.");
      setState(data.state);
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
    setDocumentForm({ name: "", source: "upload", content: "" });
  };

  const submitTicket = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("create-ticket", ticketForm, "Ticket opened with a 120-minute SLA.");
    setShowTicket(false);
    setTicketForm({ subject: "", message: "", priority: "normal" });
  };

  if (!state) return <div className="loading">Loading the workspace…</div>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark" /><span>perpendicular<span className="brand-meta">open work system</span></span></div><div className="nav-scroll">{navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map((item) => { const Icon = item.icon; return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={15} strokeWidth={1.8} /><span>{item.label}</span>{item.count ? <span className="nav-count">{item.count}</span> : null}</button>; })}</div>)}</div><div className="sidebar-footer"><div className="server-chip"><span className="status-dot" />Dell node healthy</div><small>Ollama local runtime<br />Postgres-ready persistence · LAN / Dell</small></div></aside><div className="main-shell"><div className="mobile-topbar">{navigation.map((item) => { const Icon = item.icon; return <button className={`nav-item ${activeView === item.id ? "active" : ""}`} onClick={() => setActiveView(item.id)} key={item.id}><Icon size={13} /><span>{item.label}</span></button>; })}</div><header className="topbar"><div className="crumbs"><strong>Blueblood Studio</strong><span className="slash">/</span><span>{activeLabel}</span></div><div className="top-actions"><div className="server-status"><span className="status-dot" />Self-hosted · online</div><button className="command-button" onClick={() => { setActiveView("overview"); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus(), 0); }}><Sparkles size={13} />Ask the system</button></div></header><main className="content">{activeView === "overview" ? <Overview state={state} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} setView={setActiveView} chatInput={chatInput} setChatInput={setChatInput} chatBusy={busyAction === "chat"} onSend={sendChat} /> : activeView === "employees" ? <EmployeesView state={state} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} mutate={mutate} setShowHire={setShowHire} /> : activeView === "knowledge" ? <KnowledgeView state={state} setShowDocument={setShowDocument} /> : activeView === "lists" ? <ListsView state={state} mutate={mutate} /> : activeView === "sequences" ? <SequencesView state={state} mutate={mutate} /> : activeView === "inbox" ? <InboxView state={state} mutate={mutate} setShowTicket={setShowTicket} /> : activeView === "activity" ? <ActivityView state={state} /> : <SettingsView state={state} />}</main></div>{notice ? <div className="notice" role="status">{notice}</div> : null}
    {showHire ? <Modal title="Hire an employee" description="A title is enough to start. The prompt is versioned from the first save." onClose={() => setShowHire(false)}><form className="form-card" onSubmit={submitEmployee}><div className="field"><label htmlFor="employee-name">Name</label><input id="employee-name" value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} placeholder="e.g. Atlas" /></div><div className="field"><label htmlFor="employee-title">Title *</label><input id="employee-title" required value={employeeForm.title} onChange={(event) => setEmployeeForm({ ...employeeForm, title: event.target.value })} placeholder="e.g. Revenue intelligence lead" /></div><div className="field"><label htmlFor="employee-department">Department</label><select id="employee-department" value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })}><option>Growth</option><option>Content</option><option>Support</option><option>Operations</option></select></div><div className="field"><label htmlFor="employee-prompt">System prompt</label><textarea id="employee-prompt" value={employeeForm.systemPrompt} onChange={(event) => setEmployeeForm({ ...employeeForm, systemPrompt: event.target.value })} placeholder="Optional. The system writes a safe default if blank." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowHire(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-employee"}>Create employee <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showDocument ? <Modal title="Add knowledge" description="Paste the source now. The adapter stores the text and makes it searchable immediately." onClose={() => setShowDocument(false)}><form className="form-card" onSubmit={submitDocument}><div className="field"><label htmlFor="document-name">Source name</label><input id="document-name" required value={documentForm.name} onChange={(event) => setDocumentForm({ ...documentForm, name: event.target.value })} placeholder="e.g. Sales playbook" /></div><div className="field"><label htmlFor="document-source">Source type</label><select id="document-source" value={documentForm.source} onChange={(event) => setDocumentForm({ ...documentForm, source: event.target.value })}><option value="upload">Upload / paste</option><option value="url">URL capture</option></select></div><div className="field"><label htmlFor="document-content">Content</label><textarea id="document-content" required value={documentForm.content} onChange={(event) => setDocumentForm({ ...documentForm, content: event.target.value })} placeholder="The facts employees should be able to retrieve…" /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowDocument(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-document"}>Index source <ArrowUpRight size={13} /></button></div></form></Modal> : null}
    {showTicket ? <Modal title="Open a ticket" description="Create a support item with an owner and a visible SLA clock." onClose={() => setShowTicket(false)}><form className="form-card" onSubmit={submitTicket}><div className="field"><label htmlFor="ticket-subject">Subject</label><input id="ticket-subject" required value={ticketForm.subject} onChange={(event) => setTicketForm({ ...ticketForm, subject: event.target.value })} placeholder="What needs attention?" /></div><div className="field"><label htmlFor="ticket-priority">Priority</label><select id="ticket-priority" value={ticketForm.priority} onChange={(event) => setTicketForm({ ...ticketForm, priority: event.target.value })}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div><div className="field"><label htmlFor="ticket-message">Context</label><textarea id="ticket-message" required value={ticketForm.message} onChange={(event) => setTicketForm({ ...ticketForm, message: event.target.value })} placeholder="Give the employee or human owner enough context to act." /></div><div className="form-actions"><button type="button" className="button-secondary" onClick={() => setShowTicket(false)}>Cancel</button><button type="submit" className="button-primary" disabled={busyAction === "create-ticket"}>Open ticket <ArrowUpRight size={13} /></button></div></form></Modal> : null}
  </div>;
}
