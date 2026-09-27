import { createId, type Sequence, type SequenceStep, type SmartRow } from "@/lib/domain";

const sequenceChannels = ["Email", "LinkedIn", "Task"] as const;

type SequenceStepInput = {
  channel?: unknown;
  title?: unknown;
  delay?: unknown;
  body?: unknown;
  subject?: unknown;
};

export function buildSequenceSteps(value: unknown, fallback: { subject?: string; body?: string }) {
  const rawSteps = Array.isArray(value) ? value : [];
  const inputs = rawSteps.length
    ? rawSteps.slice(0, 5)
    : [{ channel: "Email", title: "First touch", delay: "Day 0", subject: fallback.subject, body: fallback.body }];
  const steps = inputs.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Sequence step ${index + 1} is invalid.`);
    const input = raw as SequenceStepInput;
    const channel = sequenceChannels.includes(input.channel as never) ? input.channel as SequenceStep["channel"] : "Email";
    const title = String(input.title || (index === 0 ? "First touch" : `Follow-up ${index}`)).trim();
    const delay = String(input.delay || (index === 0 ? "Day 0" : "After 3 days")).trim();
    const body = String(input.body || "").trim();
    const subject = String(input.subject || "").trim();
    if (!title || !delay || !body) throw new Error(`Sequence step ${index + 1} needs a title, delay, and message.`);
    return { id: createId("step"), channel, title, delay, body, subject: subject || undefined } satisfies SequenceStep;
  });
  return steps;
}

export function sequenceRequiresGmail(sequence: Pick<Sequence, "steps">) {
  return sequence.steps.some((step) => step.channel === "Email");
}

export function sequenceStepIdempotencyKey(workspaceId: string, sequenceId: string, rowId: string, stepIndex: number) {
  return `sequence:${workspaceId}:${sequenceId}:${rowId}:step:${stepIndex}`;
}

export function renderSequenceTemplate(template: string, row: SmartRow) {
  const firstName = row.name.trim().split(/\s+/)[0] || row.name;
  return template
    .replaceAll("{{firstName}}", firstName)
    .replaceAll("{{companyName}}", row.company)
    .replaceAll("{{role}}", row.role)
    .replaceAll("{{email}}", row.email);
}

export function sequenceEmailFor(sequence: Sequence, step: SequenceStep, row: SmartRow) {
  const subject = renderSequenceTemplate(step.subject?.trim() || `${step.title} · ${row.company}`, row).replace(/[\r\n]/g, " ").trim();
  const body = renderSequenceTemplate(step.body, row).trim();
  if (!subject || !body) throw new Error("The sequence email needs a subject and body before it can be sent.");
  return { subject, body };
}
