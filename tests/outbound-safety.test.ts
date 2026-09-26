import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOutboundSafetySettings,
  outboundSafetyDecision,
  startOfLocalDay,
  validateOutboundSafetySettings,
} from "@/lib/outbound-safety";

test("outbound safety blocks suppressed domains and subdomains", () => {
  const settings = { ...defaultOutboundSafetySettings(), suppressedDomains: ["example.com"] };
  assert.equal(outboundSafetyDecision({ settings, email: "person@mail.example.com", now: new Date("2026-09-26T12:00:00Z") }).allowed, false);
  assert.equal(outboundSafetyDecision({ settings, email: "person@other.com", now: new Date("2026-09-26T12:00:00Z") }).allowed, true);
});

test("outbound safety applies the configured local window and weekend rule", () => {
  const settings = { ...defaultOutboundSafetySettings(), timezone: "Asia/Kolkata", sendWindowStart: "09:00", sendWindowEnd: "17:00", skipWeekends: true };
  assert.equal(outboundSafetyDecision({ settings, email: "person@other.com", now: new Date("2026-09-25T05:00:00Z") }).allowed, true);
  assert.equal(outboundSafetyDecision({ settings, email: "person@other.com", now: new Date("2026-09-25T02:00:00Z") }).allowed, false);
  const weekend = outboundSafetyDecision({ settings, email: "person@other.com", now: new Date("2026-09-26T05:00:00Z") });
  assert.equal(weekend.allowed, false);
  if (!weekend.allowed) assert.equal(weekend.code, "weekend");
});

test("local-day boundaries are calculated in the workspace timezone", () => {
  const start = startOfLocalDay(new Date("2026-09-26T12:34:00Z"), "Asia/Kolkata");
  assert.equal(start.toISOString(), "2026-09-25T18:30:00.000Z");
});

test("outbound settings reject unsafe windows and malformed suppression domains", () => {
  assert.match(String(validateOutboundSafetySettings({ ...defaultOutboundSafetySettings(), sendWindowStart: "17:00", sendWindowEnd: "09:00" }).error), /later than/);
  assert.match(String(validateOutboundSafetySettings({ ...defaultOutboundSafetySettings(), suppressedDomains: ["not a domain"] }).error), /Suppressed domains/);
});
