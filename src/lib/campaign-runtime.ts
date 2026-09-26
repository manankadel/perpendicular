import { addActivity, timestamp, type Campaign, type WorkspaceState } from "@/lib/domain";
import { publishContentInState, scheduleContentInState } from "@/lib/content-runtime";

function findCampaign(state: WorkspaceState, campaignId: string) {
  return state.campaigns.find((campaign) => campaign.id === campaignId);
}

function attachedContent(state: WorkspaceState, campaign: Campaign) {
  if (!campaign.contentId) throw new Error("Attach content before scheduling this campaign.");
  const content = state.content.find((item) => item.id === campaign.contentId);
  if (!content || !content.body) throw new Error("Generate the campaign content before scheduling it.");
  if (content.channel !== "website" && content.channel !== "blog") throw new Error("Native campaign delivery currently supports website and blog content. External channels remain provider-gated.");
  return content;
}

export function scheduleCampaignInState(state: WorkspaceState, campaignId: string, scheduledAt?: string | null) {
  const campaign = findCampaign(state, campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status !== "draft") throw new Error("Only draft campaigns can be scheduled.");
  const content = attachedContent(state, campaign);
  if (!["approved", "scheduled"].includes(content.status)) throw new Error("Approve the campaign content before scheduling it.");
  const date = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) throw new Error("Campaign time is invalid.");
  scheduleContentInState(state, content.id, date.toISOString());
  campaign.status = "scheduled";
  campaign.scheduledAt = date.toISOString();
  campaign.updatedAt = timestamp();
  campaign.lastResult = null;
  addActivity(state, { type: "content", title: `${campaign.name} was scheduled`, detail: `Native ${content.channel} publication at ${campaign.scheduledAt}` });
  return campaign;
}

export function executeCampaignInState(state: WorkspaceState, campaignId: string, now = Date.now()) {
  const campaign = findCampaign(state, campaignId);
  if (!campaign || campaign.status !== "scheduled" || !campaign.scheduledAt || new Date(campaign.scheduledAt).getTime() > now) return null;
  const content = attachedContent(state, campaign);
  const published = publishContentInState(state, content.id);
  campaign.status = "completed";
  campaign.lastRunAt = timestamp();
  campaign.lastResult = published.slug ? `Published /site/${published.slug}` : "Published";
  campaign.updatedAt = timestamp();
  addActivity(state, { type: "content", title: `${campaign.name} completed`, detail: campaign.lastResult });
  return campaign;
}
