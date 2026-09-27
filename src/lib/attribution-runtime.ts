import { createAttributionTouch, attributionKey, summarizeAttribution, type AttributionChannel, type AttributionSummary, type AttributionTouch } from "@/lib/attribution";
import type { DealRecord, WorkspaceState } from "@/lib/domain";

export type AttributionInput = Partial<Pick<AttributionTouch, "source" | "medium" | "campaign" | "content" | "term">>;

export function recordAttributionTouchInState(state: WorkspaceState, touch: AttributionTouch) {
  const touches = Array.isArray(state.attributionTouches) ? state.attributionTouches : [];
  if (!touches.some((candidate) => attributionKey(candidate) === attributionKey(touch))) touches.unshift(touch);
  state.attributionTouches = touches.slice(0, 5000);
  return touch;
}

export function touchFromInput(input: { sessionId: unknown; channel: AttributionChannel; attribution?: AttributionInput | null; capturedAt?: string }) {
  const attribution = input.attribution || {};
  return createAttributionTouch({
    sessionId: input.sessionId,
    channel: input.channel,
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
    content: attribution.content,
    term: attribution.term,
    capturedAt: input.capturedAt,
  });
}

export function attributionForSession(state: WorkspaceState, sessionId: string | null | undefined): AttributionSummary {
  if (!sessionId) return summarizeAttribution([]);
  return summarizeAttribution((state.attributionTouches || []).filter((touch) => touch.sessionId === sessionId));
}

export function dealAttribution(state: WorkspaceState, sessionId: string | null | undefined): DealRecord["attribution"] {
  const summary = attributionForSession(state, sessionId);
  if (!summary.touchCount) return null;
  return { ...summary, sessionId: sessionId || summary.firstTouch?.sessionId || null };
}

export function recordDealAttribution(state: WorkspaceState, args: { dealId: string; sessionId?: string | null; attribution?: AttributionInput | null }) {
  const supplied = touchFromInput({ sessionId: args.sessionId || `deal_${args.dealId}`, channel: "manual", attribution: args.attribution });
  if (supplied && Object.values(args.attribution || {}).some((item) => String(item || "").trim())) recordAttributionTouchInState(state, supplied);
  return dealAttribution(state, args.sessionId || (supplied ? supplied.sessionId : null));
}
