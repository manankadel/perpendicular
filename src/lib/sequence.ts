import type { Sequence, SequenceStep, SmartRow } from "@/lib/domain";

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
