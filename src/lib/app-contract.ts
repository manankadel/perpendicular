import type { AppRecord } from "@/lib/domain";

export function appTaskFor(app: Pick<AppRecord, "name" | "description" | "task">, input: string) {
  const instruction = app.task.trim() || app.description.trim() || `Complete the ${app.name} workflow.`;
  const operatorInput = input.trim();
  return operatorInput
    ? `${instruction}\n\nOperator input:\n${operatorInput}`
    : instruction;
}

