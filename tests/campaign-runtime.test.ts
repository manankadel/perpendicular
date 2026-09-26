import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, type Campaign, type ContentItem } from "@/lib/domain";
import { executeCampaignInState, scheduleCampaignInState } from "@/lib/campaign-runtime";

test("native content campaigns schedule and complete through a public page", () => {
  const state = createInitialState("campaign-runtime-test");
  const createdAt = new Date(Date.now() - 1_000).toISOString();
  const content: ContentItem = { id: "content-campaign", title: "Campaign page", channel: "website", objective: "Explain the launch.", status: "approved", body: "The launch is grounded and public.", employeeId: state.employees[0]?.id || null, missionId: null, scheduledAt: null, createdAt, updatedAt: createdAt };
  const campaign: Campaign = { id: "campaign-test", name: "Launch campaign", type: "content", audience: "Public", status: "draft", scheduledAt: null, contentId: content.id, listId: null, createdAt, updatedAt: createdAt };
  state.content = [content];
  state.campaigns = [campaign];
  state.inboundAgents = [{ id: "agent-campaign", name: "Site operator", description: "Answers visitors.", greeting: "How can I help?", channel: "website", employeeId: state.employees[0]?.id || "", status: "live", createdAt, updatedAt: createdAt }];
  scheduleCampaignInState(state, campaign.id, createdAt);
  const executed = executeCampaignInState(state, campaign.id);
  assert.equal(executed?.status, "completed");
  assert.equal(campaign.lastResult, "Published /site/campaign-page");
  assert.equal(state.content[0]?.status, "published");
});

test("broadcast campaigns cannot enter the native scheduler", () => {
  const state = createInitialState("broadcast-campaign-test");
  const createdAt = new Date().toISOString();
  const campaign: Campaign = { id: "campaign-broadcast", name: "Product update", type: "broadcast", audience: "Founders", status: "draft", scheduledAt: null, contentId: null, listId: "list-growth", subject: "A useful update", body: "Hello {{firstName}}", createdAt, updatedAt: createdAt };
  state.campaigns = [campaign];
  assert.throws(() => scheduleCampaignInState(state, campaign.id), /explicit Gmail send/);
});
