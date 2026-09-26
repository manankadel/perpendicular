import test from "node:test";
import assert from "node:assert/strict";
import { sequenceEmailFor, sequenceStepIdempotencyKey } from "../src/lib/sequence";
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
