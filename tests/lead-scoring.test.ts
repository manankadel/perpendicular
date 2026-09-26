import test from "node:test";
import assert from "node:assert/strict";
import { scoreLead } from "@/lib/lead-scoring";

test("lead scoring exposes deterministic reasons instead of an opaque score", () => {
  const result = scoreLead({ email: "founder@acme.com", role: "Founder", company: "Acme", researchText: "B2B SaaS platform with pricing for enterprise customers" });
  assert.equal(result.score, 98);
  assert.equal(result.intent, "Potential buying signal");
  assert.match(result.reasons.join(" "), /Senior decision-maker/);
  assert.match(result.reasons.join(" "), /Public\/company signals/);
});

test("lead scoring stays honest when the row has no research", () => {
  const result = scoreLead({ email: "person@gmail.com", role: "Unknown", company: "Acme" });
  assert.equal(result.intent, "Unresearched lead");
  assert.match(result.reasons.join(" "), /Research required/);
  assert.match(result.reasons.join(" "), /Free-mail domain/);
});
