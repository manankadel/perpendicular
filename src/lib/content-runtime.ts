import { addActivity, createId, timestamp, type ContentItem, type WorkspaceState } from "@/lib/domain";

function findContent(state: WorkspaceState, contentId: string) {
  return state.content.find((item) => item.id === contentId);
}

function publicPageSlug(state: WorkspaceState, title: string) {
  const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || createId("site");
  let slug = baseSlug;
  let collision = 2;
  while (state.sites.some((site) => site.slug === slug)) slug = `${baseSlug}-${collision++}`;
  return slug;
}

export function scheduleContentInState(state: WorkspaceState, contentId: string, scheduledAt?: string | null) {
  const item = findContent(state, contentId);
  if (!item || !item.body) throw new Error("Generate the content draft before scheduling it.");
  if (!["approved", "scheduled"].includes(item.status)) throw new Error("Approve the content before scheduling it.");
  const date = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) throw new Error("Scheduled time is invalid.");
  item.status = "scheduled";
  item.scheduledAt = date.toISOString();
  item.updatedAt = timestamp();
  addActivity(state, { type: "content", title: `${item.title} was scheduled`, detail: `${item.channel} · ${item.scheduledAt}` });
  return item;
}

export function publishContentInState(state: WorkspaceState, contentId: string) {
  const item = findContent(state, contentId);
  if (!item || !["approved", "scheduled"].includes(item.status)) throw new Error("Approve the content before publishing it.");
  if (item.channel === "website" || item.channel === "blog") {
    const agent = state.inboundAgents.find((candidate) => candidate.status === "live" && candidate.employeeId);
    if (!agent) throw new Error("Publish a website operator before publishing website content.");
    const slug = publicPageSlug(state, item.title);
    state.sites.unshift({
      id: createId("site"),
      name: item.title,
      kind: item.channel === "blog" ? "website" : "landing_page",
      slug,
      agentId: agent.id,
      sourceContentId: item.id,
      status: "published",
      headline: item.title,
      body: item.body,
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });
    item.status = "published";
    item.updatedAt = timestamp();
    addActivity(state, { type: "content", title: `${item.title} was published as a public page`, detail: `/site/${slug} · grounded site chat is live` });
    return { item, delivery: "native-site" as const, slug };
  }
  item.status = "published";
  item.updatedAt = timestamp();
  addActivity(state, { type: "content", title: `${item.title} was marked published`, detail: "Editorial state updated. External channel delivery still requires its provider adapter." });
  return { item, delivery: "editorial-record" as const, slug: null };
}

export function publishDueContentInState(state: WorkspaceState, now = Date.now()) {
  const due = state.content.filter((item) => item.status === "scheduled" && item.scheduledAt && new Date(item.scheduledAt).getTime() <= now && (item.channel === "website" || item.channel === "blog"));
  return due.map((item: ContentItem) => publishContentInState(state, item.id));
}
