import test from "node:test";
import assert from "node:assert/strict";
import { buildSequenceSteps, sequenceEmailFor, sequenceRequiresGmail, sequenceStepIdempotencyKey } from "../src/lib/sequence";
import type { Sequence, SmartRow } from "../src/lib/domain";

const row: SmartRow = {
  id: "row-1",
  name: "Sana Kapoor",
  email: "sana@example.com",
  company: "Meridian Labs",
  role: "Founder",
  location: "Bengaluru",
  score: 90,
  status: "enriched",
  emailStatus: "verified",
  intent: "Hiring",
  companyInsight: "A real company",
  enrollmentStatus: "enrolled",
  lastAction: null,
};

const sequence: Sequence = {
  id: "seq-1",
  name: "Founder Follow-through",
  status: "live",
  audience: "Founders",
  enrolled: 1,
  sent: 0,
  replied: 0,
  booked: 0,
  steps: [],
};

test("sequence email rendering personalizes only supported lead fields", () => {
  const email = sequenceEmailFor(sequence, { id: "step-1", channel: "Email", title: "A useful observation", delay: "Day 0", subject: "A thought for {{companyName}}", body: "Hi {{firstName}} — noticed {{companyName}} is led by a {{role}}." }, row);
  assert.equal(email.subject, "A thought for Meridian Labs");
  assert.equal(email.body, "Hi Sana — noticed Meridian Labs is led by a Founder.");
});

test("sequence send keys are stable per workspace, lead, and step", () => {
  const key = sequenceStepIdempotencyKey("workspace-1", "seq-1", "row-1", 0);
  assert.equal(key, "sequence:workspace-1:seq-1:row-1:step:0");
  assert.equal(key, sequenceStepIdempotencyKey("workspace-1", "seq-1", "row-1", 0));
  assert.notEqual(key, sequenceStepIdempotencyKey("workspace-1", "seq-1", "row-1", 1));
});

test("sequence builder creates a safe email fallback", () => {
  const steps = buildSequenceSteps(undefined, { subject: "Hello {{companyName}}", body: "Hi {{firstName}}" });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].channel, "Email");
  assert.equal(steps[0].subject, "Hello {{companyName}}");
  assert.equal(steps[0].body, "Hi {{firstName}}");
});

test("sequence builder keeps five bounded, supported steps", () => {
  const steps = buildSequenceSteps([
    { channel: "Email", title: "First touch", delay: "Day 0", subject: "One", body: "First" },
    { channel: "LinkedIn", title: "Connect", delay: "Day 2", body: "Send a connection request" },
    { channel: "Task", title: "Review", delay: "Day 4", body: "Review the account" },
    { channel: "Email", title: "Follow-up", delay: "Day 7", subject: "Two", body: "Second" },
    { channel: "Task", title: "Close loop", delay: "Day 10", body: "Decide next action" },
    { channel: "Email", title: "Ignored", delay: "Day 12", subject: "Three", body: "Ignored" },
  ], {});
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((step) => step.channel), ["Email", "LinkedIn", "Task", "Email", "Task"]);
  assert.equal(steps[1].body, "Send a connection request");
});

test("sequence builder rejects steps without a message", () => {
  assert.throws(() => buildSequenceSteps([{ channel: "Email", title: "Empty", delay: "Day 0", subject: "No body", body: "" }], {}), /needs a title, delay, and message/);
});

test("manual sequence steps do not require Gmail while email steps do", () => {
  assert.equal(sequenceRequiresGmail({ steps: [{ id: "step-1", channel: "Task", title: "Review", delay: "Day 0", body: "Review the account" }] }), false);
  assert.equal(sequenceRequiresGmail({ steps: [{ id: "step-1", channel: "Email", title: "Send", delay: "Day 0", body: "Hello" }] }), true);
});
