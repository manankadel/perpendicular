import type { Playbook } from "@/lib/domain";

export function playbookTaskFor(playbook: Pick<Playbook, "name" | "steps">, input = "") {
  const steps = playbook.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const operatorInput = input.trim();
  return [
    `Run the ${playbook.name} playbook.`,
    `\nSteps:\n${steps}`,
    "\nUse the workspace sources, show what was completed, call out missing evidence, and finish with one owner and one next action.",
    ...(operatorInput ? [`\nOperator input:\n${operatorInput}`] : []),
  ].join("\n");
}
