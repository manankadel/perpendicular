import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, type ContentItem } from "@/lib/domain";
import { publishContentInState, scheduleContentInState } from "@/lib/content-runtime";

test("scheduled website content publishes a real public page with a collision-safe slug", () => {
  const state = createInitialState("content-runtime-test");
  const now = new Date(Date.now() - 1_000).toISOString();
  const item: ContentItem = {
    id: "content-test",
    title: "Launch Notes",
    channel: "blog",
    objective: "Explain the release.",
    status: "approved",
    body: "A grounded release note.",
    employeeId: state.employees[0]?.id || null,
    missionId: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  state.content = [item];
  state.inboundAgents = [{ id: "agent-test", name: "Site operator", description: "Answers questions from the site.", greeting: "How can I help?", channel: "website", employeeId: state.employees[0]?.id || "", status: "live", createdAt: now, updatedAt: now }];
  scheduleContentInState(state, item.id, now);
  assert.equal(item.status, "scheduled");
  const published = publishContentInState(state, item.id);
  assert.equal(published.delivery, "native-site");
  assert.equal(item.status, "published");
  assert.equal(state.sites[0]?.slug, "launch-notes");
  assert.equal(state.sites[0]?.sourceContentId, item.id);
});

test("external content channels cannot claim native publication", () => {
  const state = createInitialState("content-external-channel-test");
  const now = new Date().toISOString();
  const item: ContentItem = {
    id: "content-linkedin",
    title: "LinkedIn draft",
    channel: "linkedin",
    objective: "Explain the launch.",
    status: "approved",
    body: "The approved draft.",
    employeeId: state.employees[0]?.id || null,
    missionId: null,
    scheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  state.content = [item];
  assert.throws(() => scheduleContentInState(state, item.id), /can be scheduled natively/);
  assert.throws(() => publishContentInState(state, item.id), /cannot publish this channel/);
  assert.equal(item.status, "approved");
});
