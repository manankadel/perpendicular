export type AttributionChannel = "site" | "widget" | "manual";

export type AttributionTouch = {
  sessionId: string;
  channel: AttributionChannel;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  capturedAt: string;
};

export type AttributionSummary = {
  firstTouch: AttributionTouch | null;
  lastTouch: AttributionTouch | null;
  touchCount: number;
  linear: Array<{ touch: AttributionTouch; weight: number }>;
};

const MAX_VALUE_LENGTH = 120;

function value(input: unknown) {
  const normalized = String(input ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return normalized ? normalized.slice(0, MAX_VALUE_LENGTH) : null;
}

export function validAttributionSessionId(input: unknown) {
  const candidate = String(input ?? "").trim();
  return candidate && candidate.length <= 120 && /^[a-zA-Z0-9:_-]+$/.test(candidate) ? candidate : null;
}

export function createAttributionTouch(input: {
  sessionId: unknown;
  channel: AttributionChannel;
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
  content?: unknown;
  term?: unknown;
  capturedAt?: string;
}) {
  const sessionId = validAttributionSessionId(input.sessionId);
  if (!sessionId) return null;
  return {
    sessionId,
    channel: input.channel,
    source: value(input.source),
    medium: value(input.medium),
    campaign: value(input.campaign),
    content: value(input.content),
    term: value(input.term),
    capturedAt: typeof input.capturedAt === "string" && input.capturedAt ? input.capturedAt : new Date().toISOString(),
  } satisfies AttributionTouch;
}

export function attributionKey(touch: AttributionTouch) {
  return [touch.sessionId, touch.channel, touch.source, touch.medium, touch.campaign, touch.content, touch.term].join("|");
}

export function summarizeAttribution(touches: AttributionTouch[]): AttributionSummary {
  const ordered = [...touches].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  const weight = ordered.length ? 1 / ordered.length : 0;
  return {
    firstTouch: ordered[0] || null,
    lastTouch: ordered.at(-1) || null,
    touchCount: ordered.length,
    linear: ordered.map((touch) => ({ touch, weight })),
  };
}

export function attributionLabel(touch: AttributionTouch | null | undefined) {
  if (!touch) return "unattributed";
  const label = [touch.source, touch.medium, touch.campaign].filter(Boolean).join(" / ");
  return label || (touch.channel === "site" ? "direct site" : touch.channel === "widget" ? "direct widget" : "manual");
}
