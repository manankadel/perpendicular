import test from "node:test";
import assert from "node:assert/strict";
import { appTaskFor } from "../src/lib/app-contract";

test("app execution combines the saved workflow instruction with operator input", () => {
  const task = appTaskFor({ name: "Lead brief", description: "Fallback", task: "Write a concise account brief." }, "Review Acme and name the missing evidence.");
  assert.equal(task, "Write a concise account brief.\n\nOperator input:\nReview Acme and name the missing evidence.");
});

test("app execution still has a useful task when a legacy record has no task", () => {
  const task = appTaskFor({ name: "Support triage", description: "Prioritize the open queue.", task: "" }, "");
  assert.equal(task, "Prioritize the open queue.");
});

