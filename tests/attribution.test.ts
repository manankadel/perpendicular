import test from "node:test";
import assert from "node:assert/strict";
import { createAttributionTouch, summarizeAttribution } from "../src/lib/attribution";
import { recordDealAttribution } from "../src/lib/attribution-runtime";
import type { WorkspaceState } from "../src/lib/domain";

function state(): WorkspaceState {
  return {
    workspace: { id: "test", name: "Test", plan: "Open Source", aiCredits: { remaining: 10, limit: 10 }, dataCredits: { remaining: 10, purchased: 10 }, region: "LAN / Dell", model: "test", onboarding: {} as WorkspaceState["workspace"]["onboarding"] },
    profile: {} as WorkspaceState["profile"], members: [], employees: [], documents: [], conversations: [], widget: {} as WorkspaceState["widget"], widgetConversations: [], attributionTouches: [], deliverabilityChecks: [], runs: [], missions: [], content: [], playbooks: [], lists: [], sequences: [], schedules: [], people: [], deals: [], leadSources: [], campaigns: [], keywordMonitors: [], inboundAgents: [], sites: [], apps: [], tickets: [], activity: [], suppressedEmails: [], outboundSafety: {} as WorkspaceState["outboundSafety"], integrations: [],
  };
}

test("attribution exposes first, last, and equal linear credit", () => {
  const first = createAttributionTouch({ sessionId: "site_session", channel: "site", source: "google", medium: "cpc", campaign: "launch", capturedAt: "2026-01-01T00:00:00.000Z" });
  const last = createAttributionTouch({ sessionId: "site_session", channel: "site", source: "linkedin", medium: "social", campaign: "launch", capturedAt: "2026-01-02T00:00:00.000Z" });
  assert.ok(first && last);
  const summary = summarizeAttribution([last, first]);
  assert.equal(summary.firstTouch?.source, "google");
  assert.equal(summary.lastTouch?.source, "linkedin");
  assert.deepEqual(summary.linear.map((entry) => entry.weight), [0.5, 0.5]);
});

test("deal creation persists a session's attribution summary", () => {
  const workspace = state();
  const touch = createAttributionTouch({ sessionId: "site_session", channel: "site", source: "newsletter", medium: "email", campaign: "q4" });
  assert.ok(touch);
  workspace.attributionTouches.push(touch);
  const attribution = recordDealAttribution(workspace, { dealId: "deal_1", sessionId: "site_session" });
  assert.equal(attribution?.firstTouch?.source, "newsletter");
  assert.equal(attribution?.lastTouch?.campaign, "q4");
  assert.equal(attribution?.linear[0]?.weight, 1);
});
