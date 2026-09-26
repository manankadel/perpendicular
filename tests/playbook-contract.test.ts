import test from "node:test";
import assert from "node:assert/strict";
import { playbookTaskFor } from "../src/lib/playbook-contract";

test("playbook execution includes every saved step and optional operator context", () => {
  const task = playbookTaskFor({ name: "Weekly review", steps: ["Inspect pipeline", "Name next action"] }, "Focus on Acme.");
  assert.match(task, /1\. Inspect pipeline/);
  assert.match(task, /2\. Name next action/);
  assert.match(task, /Operator input:\nFocus on Acme\./);
});
